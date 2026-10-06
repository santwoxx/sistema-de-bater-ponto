import { randomUUID } from "node:crypto";
import { FieldValue, Timestamp, type DocumentData, type DocumentReference } from "firebase-admin/firestore";
import { HttpsError, onCall } from "firebase-functions/https";
import * as logger from "firebase-functions/logger";
import { bucket, db } from "./admin";
import { carregarEmpresa, exigirDispositivo } from "./acesso";
import { sha256, verificarPin } from "./seguranca";
import { dataLocal, horaLocal } from "./tempo";
import { normalizarMatricula, objeto } from "./validacao";

const MAX_FOTO_BYTES = 400 * 1024;
const MAX_MINIATURA_BYTES = 16 * 1024;

// Proteção contra adivinhação de PIN:
//  - por funcionário: 5 erros seguidos bloqueiam a matrícula por 15 minutos;
//  - por aparelho: 25 erros em 15 minutos bloqueiam o aparelho até a janela passar.
const MAX_FALHAS_PIN = 5;
const BLOQUEIO_PIN_MS = 15 * 60_000;
const MAX_FALHAS_APARELHO = 25;
const JANELA_FALHAS_APARELHO_MS = 15 * 60_000;

const HASH_INICIAL = "0".repeat(64);

function credenciaisInvalidas(): HttpsError {
  return new HttpsError("permission-denied", "Matrícula ou PIN inválidos.");
}

function decodificarJpeg(valor: unknown, campo: string, maxBytes: number): Buffer {
  if (typeof valor !== "string" || valor.length === 0) {
    throw new HttpsError("invalid-argument", `${campo} não recebida. Verifique a câmera do aparelho.`);
  }
  const base64 = valor.replace(/^data:image\/jpeg;base64,/, "");
  if (base64.length > Math.ceil((maxBytes * 4) / 3) + 4 || !/^[A-Za-z0-9+/]+={0,2}$/.test(base64)) {
    throw new HttpsError("invalid-argument", `${campo} inválida ou grande demais.`);
  }
  const bytes = Buffer.from(base64, "base64");
  const ehJpeg = bytes.length > 100 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  if (!ehJpeg || bytes.length > maxBytes) throw new HttpsError("invalid-argument", `${campo} inválida.`);
  return bytes;
}

async function registrarFalhaPin(credenciaisRef: DocumentReference): Promise<void> {
  await db.runTransaction(async (tx) => {
    const falhas = ((await tx.get(credenciaisRef)).get("falhas") ?? 0) + 1;
    if (falhas >= MAX_FALHAS_PIN) {
      tx.update(credenciaisRef, { falhas: 0, bloqueadoAte: Timestamp.fromMillis(Date.now() + BLOQUEIO_PIN_MS) });
    } else {
      tx.update(credenciaisRef, { falhas });
    }
  });
}

async function registrarFalhaAparelho(dispositivoRef: DocumentReference): Promise<void> {
  await db.runTransaction(async (tx) => {
    const atual = (await tx.get(dispositivoRef)).get("falhas") as { inicio: Timestamp; quantidade: number } | undefined;
    const agora = Date.now();
    if (!atual || agora - atual.inicio.toMillis() > JANELA_FALHAS_APARELHO_MS) {
      tx.update(dispositivoRef, { falhas: { inicio: Timestamp.fromMillis(agora), quantidade: 1 } });
    } else {
      tx.update(dispositivoRef, { "falhas.quantidade": atual.quantidade + 1 });
    }
  });
}

function aparelhoBloqueado(dispositivo: DocumentData): boolean {
  const falhas = dispositivo.falhas as { inicio: Timestamp; quantidade: number } | undefined;
  return Boolean(
    falhas && Date.now() - falhas.inicio.toMillis() <= JANELA_FALHAS_APARELHO_MS && falhas.quantidade >= MAX_FALHAS_APARELHO,
  );
}

function resposta(registroId: string, registro: DocumentData, ordinal: number, empresaNome: string) {
  return {
    registroId,
    nsr: registro.nsr as number,
    dataHora: (registro.dataHora as Timestamp).toMillis(),
    dataLocal: registro.dataLocal as string,
    horaLocal: registro.horaLocal as string,
    funcionarioNome: registro.funcionarioNome as string,
    ordinal,
    tipo: ordinal % 2 === 1 ? "entrada" : "saida",
    empresaNome,
    codigoVerificacao: String(registro.hash).slice(0, 12).toUpperCase(),
  };
}

export const registrarPonto = onCall({ memory: "512MiB", timeoutSeconds: 30 }, async (request) => {
  const { dispositivoId, empresaId } = exigirDispositivo(request);
  const dados = objeto(request.data);

  // O id da requisição é gerado pelo aparelho e vira o id do registro:
  // se a internet cair e o aparelho reenviar, não nasce um registro duplicado.
  const idRequisicao = typeof dados.idRequisicao === "string" ? dados.idRequisicao : "";
  if (!/^[A-Za-z0-9-]{16,64}$/.test(idRequisicao)) throw new HttpsError("invalid-argument", "Requisição inválida.");
  if (typeof dados.matricula !== "string" || !/^\d{1,10}$/.test(dados.matricula)) throw credenciaisInvalidas();
  if (typeof dados.pin !== "string" || !/^\d{4,6}$/.test(dados.pin)) throw credenciaisInvalidas();
  const matricula = normalizarMatricula(dados.matricula);
  const pin = dados.pin;
  const foto = decodificarJpeg(dados.foto, "Foto", MAX_FOTO_BYTES);
  const miniatura = decodificarJpeg(dados.miniatura, "Miniatura da foto", MAX_MINIATURA_BYTES);

  const empresaRef = db.doc(`empresas/${empresaId}`);
  const dispositivoRef = empresaRef.collection("dispositivos").doc(dispositivoId);
  const registroRef = empresaRef.collection("registros").doc(idRequisicao);

  const [empresa, dispositivoSnap, registroSnap, funcionarios] = await Promise.all([
    carregarEmpresa(empresaId),
    dispositivoRef.get(),
    registroRef.get(),
    empresaRef.collection("funcionarios").where("matricula", "==", matricula).limit(1).get(),
  ]);

  const dispositivo = dispositivoSnap.data();
  if (!dispositivo || dispositivo.ativo !== true) {
    throw new HttpsError("permission-denied", "Este aparelho foi desativado. Peça ao gestor para ativá-lo novamente.");
  }
  if (!empresa.ativo) throw new HttpsError("failed-precondition", "Empresa desativada. Procure o gestor.");
  if (aparelhoBloqueado(dispositivo)) {
    throw new HttpsError("resource-exhausted", "Muitas tentativas inválidas neste aparelho. Aguarde alguns minutos.");
  }

  const funcionarioDoc = funcionarios.docs[0];
  const funcionario = funcionarioDoc?.data();
  if (!funcionarioDoc || !funcionario || funcionario.ativo !== true) {
    await registrarFalhaAparelho(dispositivoRef);
    throw credenciaisInvalidas();
  }
  const funcionarioId = funcionarioDoc.id;
  const fuso = empresa.fusoHorario;
  const hoje = dataLocal(new Date(), fuso);

  const credenciaisRef = empresaRef.collection("credenciais").doc(funcionarioId);
  const [credenciaisSnap, marcacoesHoje] = await Promise.all([
    credenciaisRef.get(),
    empresaRef.collection("registros").where("funcionarioId", "==", funcionarioId).where("dataLocal", "==", hoje).get(),
  ]);

  // Reenvio de uma requisição que já foi gravada: devolve o mesmo comprovante.
  if (registroSnap.exists) {
    const existente = registroSnap.data()!;
    if (existente.dispositivoId !== dispositivoId || existente.funcionarioId !== funcionarioId) {
      throw new HttpsError("already-exists", "Requisição duplicada.");
    }
    const ordinal = marcacoesHoje.docs
      .map((doc) => doc.data())
      .filter((r) => !r.desconsiderado && r.dataHora.toMillis() <= existente.dataHora.toMillis()).length;
    return resposta(registroRef.id, existente, ordinal, empresa.nome);
  }

  const credenciais = credenciaisSnap.data();
  if (!credenciais?.pinHash) throw new HttpsError("failed-precondition", "PIN ainda não cadastrado. Procure o gestor.");
  const bloqueadoAte = (credenciais.bloqueadoAte as Timestamp | null)?.toMillis() ?? 0;
  if (bloqueadoAte > Date.now()) {
    const minutos = Math.ceil((bloqueadoAte - Date.now()) / 60_000);
    throw new HttpsError(
      "resource-exhausted",
      `Muitas tentativas incorretas. Tente novamente em ${minutos} min ou peça ao gestor para redefinir seu PIN.`,
    );
  }

  if (!(await verificarPin(pin, credenciais.pinHash, credenciais.pinSal))) {
    await Promise.all([registrarFalhaPin(credenciaisRef), registrarFalhaAparelho(dispositivoRef)]);
    logger.warn("PIN incorreto", { empresaId, funcionarioId, dispositivoId });
    throw credenciaisInvalidas();
  }

  // A foto é gravada antes do registro; se o registro falhar, ela é apagada.
  const fotoSha256 = sha256(foto);
  const fotoPath = `empresas/${empresaId}/registros/${hoje.slice(0, 7)}/${registroRef.id}.jpg`;
  const arquivo = bucket().file(fotoPath);
  await arquivo.save(foto, {
    resumable: false,
    contentType: "image/jpeg",
    metadata: {
      cacheControl: "private, max-age=31536000",
      metadata: { firebaseStorageDownloadTokens: randomUUID(), empresaId, funcionarioId, dispositivoId },
    },
  });

  let resultado: { registro: DocumentData; duplicado: boolean };
  try {
    resultado = await db.runTransaction(async (tx) => {
      const controleRef = empresaRef.collection("privado").doc("controle");
      const [controleSnap, credenciaisAtuais, registroAtual] = await Promise.all([
        tx.get(controleRef),
        tx.get(credenciaisRef),
        tx.get(registroRef),
      ]);
      if (registroAtual.exists) return { registro: registroAtual.data()!, duplicado: true };

      const agora = new Date();
      const ultima = (credenciaisAtuais.get("ultimaMarcacaoEm") as Timestamp | null)?.toDate();
      const intervaloMs = empresa.intervaloMinimoMinutos * 60_000;
      if (ultima && agora.getTime() - ultima.getTime() < intervaloMs) {
        const segundos = Math.ceil((intervaloMs - (agora.getTime() - ultima.getTime())) / 1000);
        const espera = segundos >= 60 ? `${Math.ceil(segundos / 60)} min` : `${segundos} s`;
        throw new HttpsError(
          "failed-precondition",
          `Ponto já registrado às ${horaLocal(ultima, fuso).slice(0, 5)}. Aguarde ${espera} para registrar de novo.`,
        );
      }

      // NSR (número sequencial do registro) por empresa e cadeia de hashes:
      // cada registro "assina" o anterior, então apagar ou alterar qualquer
      // marcação quebra a cadeia e é detectável.
      const nsr = ((controleSnap.get("ultimoNsr") as number | undefined) ?? 0) + 1;
      const hashAnterior = (controleSnap.get("ultimoHash") as string | undefined) ?? HASH_INICIAL;
      const hash = sha256(
        [hashAnterior, nsr, empresaId, funcionarioId, funcionario.cpf, agora.toISOString(), fotoSha256, dispositivoId].join("|"),
      );

      const registro = {
        funcionarioId,
        funcionarioNome: funcionario.nome,
        funcionarioMatricula: funcionario.matricula,
        funcionarioCpf: funcionario.cpf,
        dataHora: Timestamp.fromDate(agora),
        dataLocal: dataLocal(agora, fuso),
        horaLocal: horaLocal(agora, fuso),
        origem: "dispositivo",
        dispositivoId,
        dispositivoNome: dispositivo.nome,
        nsr,
        hash,
        hashAnterior,
        fotoPath,
        fotoSha256,
        miniatura: `data:image/jpeg;base64,${miniatura.toString("base64")}`,
        desconsiderado: null,
        criadoEm: FieldValue.serverTimestamp(),
      };

      tx.create(registroRef, registro);
      tx.set(controleRef, { ultimoNsr: nsr, ultimoHash: hash, atualizadoEm: FieldValue.serverTimestamp() }, { merge: true });
      tx.update(credenciaisRef, { ultimaMarcacaoEm: registro.dataHora, falhas: 0 });
      tx.update(dispositivoRef, { ultimoRegistroEm: registro.dataHora, ultimoSinalEm: FieldValue.serverTimestamp() });
      return { registro, duplicado: false };
    });
  } catch (erro) {
    await arquivo.delete({ ignoreNotFound: true }).catch(() => undefined);
    throw erro;
  }

  const anteriores = marcacoesHoje.docs.filter((doc) => !doc.get("desconsiderado") && doc.id !== registroRef.id).length;
  const ordinal = anteriores + 1;
  logger.info("Ponto registrado", { empresaId, funcionarioId, dispositivoId, nsr: resultado.registro.nsr });
  return resposta(registroRef.id, resultado.registro, ordinal, empresa.nome);
});

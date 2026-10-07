import { randomUUID } from "node:crypto";
import { FieldValue, Timestamp, type DocumentData } from "firebase-admin/firestore";
import { HttpsError, onCall } from "firebase-functions/https";
import * as logger from "firebase-functions/logger";
import { bucket, db } from "./admin";
import { exigirDispositivo } from "./acesso";
import { decodificarJpeg, identificarNoAparelho, lerMatriculaPin, MAX_MINIATURA_BYTES } from "./identificacao";
import { HASH_INICIAL, hashDoRegistro } from "./cadeia";
import { sha256 } from "./seguranca";
import { dataLocal, horaLocal } from "./tempo";
import { objeto } from "./validacao";

const MAX_FOTO_BYTES = 400 * 1024;

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

function erroRequisicaoDeOutro(): HttpsError {
  return new HttpsError("already-exists", "Requisição duplicada.");
}

export const registrarPonto = onCall({ memory: "512MiB", timeoutSeconds: 30 }, async (request) => {
  const { dispositivoId, empresaId } = exigirDispositivo(request);
  const dados = objeto(request.data);

  // O id da requisição é gerado pelo aparelho e vira o id do registro:
  // se a internet cair e o aparelho reenviar, não nasce um registro duplicado.
  const idRequisicao = typeof dados.idRequisicao === "string" ? dados.idRequisicao : "";
  if (!/^[A-Za-z0-9-]{16,64}$/.test(idRequisicao)) throw new HttpsError("invalid-argument", "Requisição inválida.");
  const { matricula, pin } = lerMatriculaPin(dados);
  const foto = decodificarJpeg(dados.foto, "Foto", MAX_FOTO_BYTES);
  const miniatura = decodificarJpeg(dados.miniatura, "Miniatura da foto", MAX_MINIATURA_BYTES);

  // Matrícula + PIN são conferidos antes de qualquer outra coisa, inclusive do reenvio.
  const { empresa, empresaRef, dispositivoRef, dispositivo, funcionarioId, funcionario, credenciaisRef } =
    await identificarNoAparelho({ empresaId, dispositivoId, matricula, pin, miniatura });

  const fuso = empresa.fusoHorario;
  const hoje = dataLocal(new Date(), fuso);
  const registroRef = empresaRef.collection("registros").doc(idRequisicao);
  const [registroSnap, marcacoesHoje] = await Promise.all([
    registroRef.get(),
    empresaRef
      .collection("registros")
      .where("funcionarioId", "==", funcionarioId)
      .where("dataLocal", "==", hoje)
      .select("dataHora", "desconsiderado")
      .get(),
  ]);
  // Posição da marcação no dia (1ª, 2ª...), contando só as válidas até ela.
  const ordinalDe = async (registro: DocumentData): Promise<number> => {
    const doDia =
      registro.dataLocal === hoje
        ? marcacoesHoje
        : await empresaRef
            .collection("registros")
            .where("funcionarioId", "==", funcionarioId)
            .where("dataLocal", "==", registro.dataLocal)
            .select("dataHora", "desconsiderado")
            .get();
    const limite = (registro.dataHora as Timestamp).toMillis();
    const antes = doDia.docs.filter(
      (doc) => doc.id !== registroRef.id && !doc.get("desconsiderado") && (doc.get("dataHora") as Timestamp).toMillis() <= limite,
    ).length;
    return antes + 1;
  };

  // Reenvio de uma requisição que já foi gravada: devolve o mesmo comprovante.
  if (registroSnap.exists) {
    const existente = registroSnap.data()!;
    if (existente.dispositivoId !== dispositivoId || existente.funcionarioId !== funcionarioId) throw erroRequisicaoDeOutro();
    return resposta(registroRef.id, existente, await ordinalDe(existente), empresa.nome);
  }

  // A foto é gravada antes do registro, com nome único por tentativa (o registro
  // aponta para ela). Se o registro não for gravado, a foto é apagada.
  const fotoSha256 = sha256(foto);
  const fotoPath = `empresas/${empresaId}/registros/${hoje.slice(0, 7)}/${registroRef.id}-${randomUUID().slice(0, 8)}.jpg`;
  const arquivo = bucket().file(fotoPath);
  // Sem token de download: a foto só sai pelo servidor (função obterFoto), para quem tem acesso à empresa.
  await arquivo.save(foto, {
    resumable: false,
    contentType: "image/jpeg",
    metadata: { cacheControl: "private, max-age=31536000", metadata: { empresaId, funcionarioId, dispositivoId } },
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
      if (registroAtual.exists) {
        const existente = registroAtual.data()!;
        if (existente.dispositivoId !== dispositivoId || existente.funcionarioId !== funcionarioId) throw erroRequisicaoDeOutro();
        return { registro: existente, duplicado: true };
      }

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
      // marcação quebra a cadeia (ver cadeia.ts).
      const nsr = ((controleSnap.get("ultimoNsr") as number | undefined) ?? 0) + 1;
      const hashAnterior = (controleSnap.get("ultimoHash") as string | undefined) ?? HASH_INICIAL;
      const campos = {
        hashAnterior,
        nsr,
        empresaId,
        funcionarioId,
        funcionarioCpf: String(funcionario.cpf),
        dataHora: agora,
        dataLocal: dataLocal(agora, fuso),
        horaLocal: horaLocal(agora, fuso),
        fotoSha256,
        dispositivoId,
      };
      const hash = hashDoRegistro(campos);

      const registro = {
        funcionarioId,
        funcionarioNome: funcionario.nome,
        funcionarioMatricula: funcionario.matricula,
        funcionarioCpf: campos.funcionarioCpf,
        dataHora: Timestamp.fromDate(agora),
        dataLocal: campos.dataLocal,
        horaLocal: campos.horaLocal,
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
      tx.update(credenciaisRef, { ultimaMarcacaoEm: registro.dataHora });
      tx.update(dispositivoRef, { ultimoRegistroEm: registro.dataHora, ultimoSinalEm: FieldValue.serverTimestamp() });
      return { registro, duplicado: false };
    });
  } catch (erro) {
    await arquivo.delete({ ignoreNotFound: true }).catch(() => undefined);
    throw erro;
  }

  if (resultado.duplicado) {
    // Reenvio que chegou junto com o original: o registro aponta para a foto do original.
    await arquivo.delete({ ignoreNotFound: true }).catch(() => undefined);
  } else {
    logger.info("Ponto registrado", { empresaId, funcionarioId, dispositivoId, nsr: resultado.registro.nsr });
  }
  return resposta(registroRef.id, resultado.registro, await ordinalDe(resultado.registro), empresa.nome);
});

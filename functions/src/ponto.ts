import { FieldValue, Timestamp, type DocumentData } from "firebase-admin/firestore";
import { HttpsError, onCall } from "firebase-functions/https";
import * as logger from "firebase-functions/logger";
import { db } from "./admin";
import { exigirDispositivo } from "./acesso";
import { decodificarJpeg, identificarNoAparelho, lerMatriculaPin, MAX_MINIATURA_BYTES } from "./identificacao";
import { comprovante, guardarFoto, MAX_FOTO_BYTES, montarMarcacao, ordinalNoDia } from "./marcacao";
import { dataLocal, horaLocal } from "./tempo";
import { objeto } from "./validacao";

function erroRequisicaoDeOutro(): HttpsError {
  return new HttpsError("already-exists", "Requisição duplicada.");
}

// 1 vCPU (as outras usam "gcf_gen1", ver admin.ts): quem está no aparelho espera
// por esta função, que começa mais rápido e atende várias marcações na mesma cópia.
export const registrarPonto = onCall({ memory: "512MiB", cpu: 1, timeoutSeconds: 30, maxInstances: 5 }, async (request) => {
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
  const doDia = (dia: string) =>
    empresaRef.collection("registros").where("funcionarioId", "==", funcionarioId).where("dataLocal", "==", dia).select("dataHora", "desconsiderado").get();
  const [registroSnap, marcacoesHoje] = await Promise.all([registroRef.get(), doDia(hoje)]);
  const ordinalDe = async (registro: DocumentData): Promise<number> => {
    const doMesmoDia = registro.dataLocal === hoje ? marcacoesHoje : await doDia(registro.dataLocal);
    return ordinalNoDia(doMesmoDia.docs, registroRef.id, (registro.dataHora as Timestamp).toMillis());
  };

  // Reenvio de uma requisição que já foi gravada: devolve o mesmo comprovante.
  if (registroSnap.exists) {
    const existente = registroSnap.data()!;
    if (existente.dispositivoId !== dispositivoId || existente.funcionarioId !== funcionarioId) throw erroRequisicaoDeOutro();
    return comprovante(registroRef.id, existente, await ordinalDe(existente), empresa.nome);
  }

  // A foto é gravada antes do registro; se o registro não for gravado, ela é apagada.
  const { fotoPath, fotoSha256, apagar } = await guardarFoto({ empresaId, registroId: registroRef.id, dataLocal: hoje, foto, funcionarioId, dispositivoId });

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
      const { registro, contador } = montarMarcacao(controleSnap, {
        empresaId,
        funcionarioId,
        funcionario,
        dispositivoId,
        dispositivoNome: dispositivo.nome,
        dataHora: agora,
        fuso,
        fotoPath,
        fotoSha256,
        miniatura,
      });
      tx.create(registroRef, registro);
      tx.set(controleRef, contador, { merge: true });
      tx.update(credenciaisRef, { ultimaMarcacaoEm: registro.dataHora });
      tx.update(dispositivoRef, { ultimoRegistroEm: registro.dataHora, ultimoSinalEm: FieldValue.serverTimestamp() });
      return { registro, duplicado: false };
    });
  } catch (erro) {
    await apagar();
    throw erro;
  }

  if (resultado.duplicado) {
    // Reenvio que chegou junto com o original: o registro aponta para a foto do original.
    await apagar();
  } else {
    logger.info("Ponto registrado", { empresaId, funcionarioId, dispositivoId, nsr: resultado.registro.nsr });
  }
  return comprovante(registroRef.id, resultado.registro, await ordinalDe(resultado.registro), empresa.nome);
});

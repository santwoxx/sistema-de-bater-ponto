import { HttpsError, onCall } from "firebase-functions/https";
import * as logger from "firebase-functions/logger";
import { bucket, db } from "./admin";
import { exigirAcessoEmpresa } from "./acesso";
import { consumirLimite } from "./limites";
import { sha256 } from "./seguranca";
import { idDocumento, objeto } from "./validacao";

// Foto completa de uma marcação. As fotos não têm link público (nem token de
// download): só saem por aqui, para quem tem acesso à empresa. Cada consulta
// fica no log, e a foto é conferida com o hash gravado no momento do registro.

export const obterFoto = onCall({ memory: "512MiB", maxInstances: 2 }, async (request) => {
  const dados = objeto(request.data);
  const empresaId = idDocumento(dados.empresaId, "Empresa");
  const registroId = idDocumento(dados.registroId, "Marcação");
  const { usuario } = await exigirAcessoEmpresa(request, empresaId);
  await consumirLimite(usuario.uid, "obterFoto");

  const registro = (await db.doc(`empresas/${empresaId}/registros/${registroId}`).get()).data();
  const caminho = typeof registro?.fotoPath === "string" ? registro.fotoPath : "";
  // O caminho vem do banco, mas mesmo assim só é aceito dentro da pasta da empresa.
  if (!caminho.startsWith(`empresas/${empresaId}/registros/`) || caminho.includes("..")) {
    throw new HttpsError("not-found", "Esta marcação não tem foto.");
  }

  let bytes: Buffer;
  try {
    [bytes] = await bucket().file(caminho).download();
  } catch (erro) {
    if ((erro as { code?: number }).code === 404) throw new HttpsError("not-found", "Foto não encontrada.");
    throw erro;
  }

  logger.info("Foto consultada", { uid: usuario.uid, empresaId, registroId });
  return {
    foto: `data:image/jpeg;base64,${bytes.toString("base64")}`,
    // false se o arquivo foi trocado ou alterado depois do registro.
    confere: sha256(bytes) === registro?.fotoSha256,
  };
});

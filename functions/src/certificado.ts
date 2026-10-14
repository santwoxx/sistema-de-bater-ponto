import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { HttpsError, type CallableRequest } from "firebase-functions/https";
import { db } from "./admin";
import { autor, exigirAdmin } from "./acesso";
import { lerCertificado, type Certificado } from "./assinatura";
import { auditarNa } from "./auditoria";
import { objeto, texto } from "./validacao";

// Certificado digital A1 do desenvolvedor (ICP-Brasil), que assina o AFD, o
// AEJ e o comprovante do trabalhador (Portaria 671, arts. 86 a 88). O arquivo
// (.pfx, já protegido pela senha) e a senha ficam em sistema/certificado, que
// nenhum navegador lê (ver firestore.rules); o painel vê só titular e validade,
// em sistema/rep.

const MAX_PFX_BYTES = 64 * 1024;

let emCache: { versao: number; certificado: Certificado | null } | null = null;

/** Certificado guardado, ou null se ainda não foi enviado (os documentos saem sem assinatura). */
export async function carregarCertificado(): Promise<Certificado | null> {
  const snap = await db.doc("sistema/certificado").get();
  const versao = (snap.get("atualizadoEm") as Timestamp | undefined)?.toMillis() ?? 0;
  if (emCache?.versao === versao) return emCache.certificado;
  const pfx = snap.get("pfx") as string | undefined;
  const certificado = pfx ? lerCertificado(Buffer.from(pfx, "base64"), String(snap.get("senha") ?? "")) : null;
  emCache = { versao, certificado };
  return certificado;
}

export async function salvarCertificado(request: CallableRequest) {
  const usuario = await exigirAdmin(request);
  const dados = objeto(request.data);
  const pfx = Buffer.from(texto(dados.pfx, "Arquivo do certificado", { max: Math.ceil((MAX_PFX_BYTES * 4) / 3) + 4 }), "base64");
  if (pfx.length === 0 || pfx.length > MAX_PFX_BYTES) throw new HttpsError("invalid-argument", "Arquivo do certificado inválido ou grande demais.");
  const senha = typeof dados.senha === "string" ? dados.senha : "";

  let certificado: Certificado;
  try {
    certificado = lerCertificado(pfx, senha);
  } catch (erro) {
    throw new HttpsError("invalid-argument", (erro as Error).message);
  }
  const agora = Date.now();
  if (certificado.validoAte.getTime() < agora) throw new HttpsError("failed-precondition", "Este certificado está vencido.");
  if (certificado.validoDe.getTime() > agora) throw new HttpsError("failed-precondition", "Este certificado ainda não começou a valer.");

  const resumo = {
    titular: certificado.titular,
    documento: certificado.documento,
    emissor: certificado.emissor,
    validoDe: Timestamp.fromDate(certificado.validoDe),
    validoAte: Timestamp.fromDate(certificado.validoAte),
    icpBrasil: certificado.icpBrasil,
    enviadoEm: FieldValue.serverTimestamp(),
    enviadoPor: autor(usuario),
  };
  const lote = db.batch();
  lote.set(db.doc("sistema/certificado"), { pfx: pfx.toString("base64"), senha, atualizadoEm: FieldValue.serverTimestamp() });
  lote.set(db.doc("sistema/rep"), { certificado: resumo }, { merge: true });
  auditarNa(lote, {
    empresaId: null,
    autor: autor(usuario),
    acao: "rep.certificado",
    descricao:
      `Certificado digital do REP-P enviado: ${certificado.titular}, válido até ${certificado.validoAte.toLocaleDateString("pt-BR")}` +
      `${certificado.icpBrasil ? "" : " (não é ICP-Brasil: as assinaturas não valem para a Portaria 671)"}.`,
    detalhes: { titular: certificado.titular, documento: certificado.documento, emissor: certificado.emissor, icpBrasil: certificado.icpBrasil },
  });
  await lote.commit();
  return { titular: certificado.titular, validoAte: certificado.validoAte.getTime(), icpBrasil: certificado.icpBrasil };
}

export async function removerCertificado(request: CallableRequest) {
  const usuario = await exigirAdmin(request);
  const lote = db.batch();
  lote.delete(db.doc("sistema/certificado"));
  lote.set(db.doc("sistema/rep"), { certificado: FieldValue.delete() }, { merge: true });
  auditarNa(lote, {
    empresaId: null,
    autor: autor(usuario),
    acao: "rep.certificado",
    descricao: "Certificado digital do REP-P removido: os documentos passam a sair sem assinatura.",
    detalhes: {},
  });
  await lote.commit();
  return { ok: true };
}

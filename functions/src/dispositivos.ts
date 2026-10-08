import { FieldValue } from "firebase-admin/firestore";
import { HttpsError, onCall } from "firebase-functions/https";
import * as logger from "firebase-functions/logger";
import { auth, db } from "./admin";
import { autor, carregarEmpresa, exigirAcessoEmpresa, exigirDispositivo } from "./acesso";
import { auditarNa } from "./auditoria";
import { dadosParaSemInternet } from "./semInternet";
import { idAleatorio, senhaAleatoria } from "./seguranca";
import { idDocumento, objeto, texto } from "./validacao";

// Cada aparelho de ponto (tablet, celular ou PC da loja) recebe uma conta
// própria, presa a UMA empresa. A conta só consegue registrar ponto: não lê
// nada do banco diretamente. O gestor pode desativá-la a qualquer momento.

/** Limite de aparelhos ativos por empresa: contém o estrago de uma conta de gestor invadida. */
const MAX_APARELHOS_ATIVOS = 50;

export const ativarDispositivo = onCall(async (request) => {
  const dados = objeto(request.data);
  const empresaId = idDocumento(dados.empresaId, "Empresa");
  const { usuario, empresa } = await exigirAcessoEmpresa(request, empresaId);
  if (!empresa.ativo) throw new HttpsError("failed-precondition", "Esta empresa está desativada.");
  const nome = texto(dados.nome, "Nome do aparelho", { min: 2, max: 60 });

  const ativos = await db.collection(`empresas/${empresaId}/dispositivos`).where("ativo", "==", true).count().get();
  if (ativos.data().count >= MAX_APARELHOS_ATIVOS) {
    throw new HttpsError("resource-exhausted", `Esta empresa já tem ${MAX_APARELHOS_ATIVOS} aparelhos ativos. Desative os que não usa mais.`);
  }

  const uid = `disp_${idAleatorio(20)}`;
  const senha = senhaAleatoria();
  const projeto = process.env.GCLOUD_PROJECT ?? "ponto";
  // E-mail técnico, nunca usado para envio: o Firebase Auth exige um e-mail para login com senha.
  const email = `${uid}@${projeto}.firebaseapp.com`;

  await auth.createUser({ uid, email, password: senha, displayName: `Ponto: ${nome}` });
  try {
    await auth.setCustomUserClaims(uid, { papel: "dispositivo", empresaId });
    const lote = db.batch();
    lote.create(db.doc(`empresas/${empresaId}/dispositivos/${uid}`), {
      nome,
      ativo: true,
      criadoEm: FieldValue.serverTimestamp(),
      criadoPor: autor(usuario),
      ultimoSinalEm: null,
      ultimoRegistroEm: null,
    });
    auditarNa(lote, {
      empresaId,
      autor: autor(usuario),
      acao: "dispositivo.ativado",
      descricao: `Aparelho de ponto "${nome}" ativado.`,
      detalhes: { dispositivoId: uid },
    });
    await lote.commit();
  } catch (erro) {
    // Sem o cadastro no banco, a conta do aparelho não pode sobrar no Auth.
    await auth.deleteUser(uid).catch(() => undefined);
    throw erro;
  }

  return { email, senha, empresaNome: empresa.nome };
});

export const desativarDispositivo = onCall(async (request) => {
  const dados = objeto(request.data);
  const empresaId = idDocumento(dados.empresaId, "Empresa");
  const dispositivoId = idDocumento(dados.dispositivoId, "Aparelho");
  const { usuario } = await exigirAcessoEmpresa(request, empresaId);

  const ref = db.doc(`empresas/${empresaId}/dispositivos/${dispositivoId}`);
  const snap = await ref.get();
  if (!snap.exists) throw new HttpsError("not-found", "Aparelho não encontrado.");

  // Primeiro bloqueia no banco (vale na hora para registros), depois apaga a conta.
  if (snap.get("ativo") !== false) {
    const lote = db.batch();
    lote.update(ref, { ativo: false, desativadoEm: FieldValue.serverTimestamp(), desativadoPor: autor(usuario) });
    auditarNa(lote, {
      empresaId,
      autor: autor(usuario),
      acao: "dispositivo.desativado",
      descricao: `Aparelho de ponto "${snap.get("nome")}" desativado.`,
      detalhes: { dispositivoId },
    });
    await lote.commit();
  }

  try {
    await auth.deleteUser(dispositivoId);
  } catch (erro) {
    if ((erro as { code?: string }).code !== "auth/user-not-found") throw erro;
  }

  return { ok: true };
});

// Chamada periodicamente pelo aparelho: devolve a hora oficial do servidor
// (o relógio do aparelho pode estar errado) e registra que ele está online.
export const sincronizarDispositivo = onCall(async (request) => {
  const { dispositivoId, empresaId } = exigirDispositivo(request);
  const ref = db.doc(`empresas/${empresaId}/dispositivos/${dispositivoId}`);
  const [snap, empresa] = await Promise.all([ref.get(), carregarEmpresa(empresaId)]);
  const dispositivo = snap.data();
  if (!dispositivo || dispositivo.ativo !== true) return { ativo: false, agora: Date.now() };

  const agenteUsuario = String(request.rawRequest.headers["user-agent"] ?? "").slice(0, 200);
  await ref.update({ ultimoSinalEm: FieldValue.serverTimestamp(), agenteUsuario });

  const agora = Date.now();
  // Para guardar batidas se a internet cair: a chave pública do servidor e a
  // âncora de horário assinada (ver semInternet.ts). Sem elas, o resto continua.
  const semInternet = await dadosParaSemInternet(dispositivoId, agora).catch((erro: unknown) => {
    logger.error("Falha ao preparar a batida sem internet", { erro });
    return null;
  });
  return {
    ativo: true,
    dispositivo: { id: dispositivoId, nome: dispositivo.nome },
    empresa: { id: empresa.id, nome: empresa.nome, fusoHorario: empresa.fusoHorario, ativo: empresa.ativo },
    agora,
    semInternet,
  };
});

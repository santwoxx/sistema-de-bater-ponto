import { FieldValue } from "firebase-admin/firestore";
import { HttpsError, onCall, type CallableRequest } from "firebase-functions/https";
import * as logger from "firebase-functions/logger";
import { auth, db } from "./admin";
import { autor, carregarEmpresa, exigirAcessoEmpresa, exigirDispositivo, type Usuario } from "./acesso";
import { auditarNa } from "./auditoria";
import { empresasDoAparelho } from "./identificacao";
import { dadosParaSemInternet } from "./semInternet";
import { idAleatorio, senhaAleatoria } from "./seguranca";
import { estadoDaCamera, idDocumento, idOpcional, listaIds, objeto, texto } from "./validacao";

// Cada aparelho de ponto (tablet, celular ou PC da loja) recebe uma conta
// própria, cadastrada em UMA empresa. O aparelho da loja pode atender também
// outras empresas escolhidas pelo gestor (ex.: empresas do mesmo grupo na mesma
// loja): o PIN diz de quem é a batida, e ela vai para a empresa do funcionário.
// A conta só consegue registrar ponto: não lê nada do banco diretamente. O
// gestor pode desativá-la a qualquer momento.

/** Limite de aparelhos ativos por empresa: contém o estrago de uma conta de gestor invadida. */
const MAX_APARELHOS_ATIVOS = 50;
const MAX_EMPRESAS_POR_APARELHO = 20;

/**
 * Outras empresas que o aparelho da loja atende, além da dele. Quem muda a lista
 * precisa gerenciar cada empresa que entra ou sai; as que entram precisam estar
 * ativas. No celular pessoal, só vale a empresa do dono.
 */
async function outrasEmpresas(usuario: Usuario, empresaId: string, valor: unknown, atuais: string[] = []): Promise<string[]> {
  const escolhidas =
    valor === undefined || valor === null
      ? []
      : listaIds(valor, "Empresas do aparelho", MAX_EMPRESAS_POR_APARELHO).filter((id) => id !== empresaId);
  const entram = escolhidas.filter((id) => !atuais.includes(id));
  const mudaram = [...entram, ...atuais.filter((id) => !escolhidas.includes(id))];
  if (usuario.papel !== "admin" && mudaram.some((id) => !usuario.empresas.includes(id))) {
    throw new HttpsError("permission-denied", "Você não tem acesso a uma das empresas escolhidas para o aparelho.");
  }
  const novas = entram.length > 0 ? await db.getAll(...entram.map((id) => db.doc(`empresas/${id}`))) : [];
  if (novas.some((snap) => !snap.exists || snap.get("ativo") === false)) {
    throw new HttpsError("invalid-argument", "Empresas do aparelho: escolha só empresas ativas.");
  }
  return escolhidas;
}

/** Nomes das empresas, na ordem dada (para a auditoria e a tela do aparelho). */
async function nomesDasEmpresas(ids: string[]): Promise<{ id: string; nome: string }[]> {
  if (ids.length === 0) return [];
  const snaps = await db.getAll(...ids.map((id) => db.doc(`empresas/${id}`)));
  return snaps.map((snap) => ({ id: snap.id, nome: String(snap.get("nome") ?? snap.id) }));
}

/**
 * Dono do aparelho, quando ele é o celular pessoal de um funcionário: só o dono
 * bate ponto nele, com o PIN dele (ver identificarNoAparelho). Sem dono, é
 * o aparelho da loja, em que cada um digita o próprio PIN.
 */
async function donoDoAparelho(empresaId: string, valor: unknown): Promise<{ id: string; nome: string } | null> {
  const funcionarioId = idOpcional(valor, "Dono do aparelho");
  if (!funcionarioId) return null;
  const snap = await db.doc(`empresas/${empresaId}/funcionarios/${funcionarioId}`).get();
  if (snap.get("ativo") !== true) throw new HttpsError("invalid-argument", "Dono do aparelho: escolha um funcionário ativo desta empresa.");
  return { id: snap.id, nome: String(snap.get("nome")) };
}

export async function ativarDispositivo(request: CallableRequest) {
  const dados = objeto(request.data);
  const empresaId = idDocumento(dados.empresaId, "Empresa");
  const { usuario, empresa } = await exigirAcessoEmpresa(request, empresaId);
  if (!empresa.ativo) throw new HttpsError("failed-precondition", "Esta empresa está desativada.");
  const nome = texto(dados.nome, "Nome do aparelho", { min: 2, max: 60 });
  const dono = await donoDoAparelho(empresaId, dados.funcionarioId);
  const outras = dono ? [] : await outrasEmpresas(usuario, empresaId, dados.empresas);
  const nomesOutras = (await nomesDasEmpresas(outras)).map((e) => e.nome);

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
      funcionarioId: dono?.id ?? null,
      funcionarioNome: dono?.nome ?? null,
      empresas: [empresaId, ...outras],
    });
    auditarNa(lote, {
      empresaId,
      autor: autor(usuario),
      acao: "dispositivo.ativado",
      descricao:
        `Aparelho de ponto "${nome}" ativado${dono ? ` como celular pessoal de ${dono.nome}` : ""}` +
        `${nomesOutras.length > 0 ? `; atende também: ${nomesOutras.join(", ")}` : ""}.`,
      detalhes: { dispositivoId: uid, funcionarioId: dono?.id ?? null, empresas: outras },
    });
    await lote.commit();
  } catch (erro) {
    // Sem o cadastro no banco, a conta do aparelho não pode sobrar no Auth.
    await auth.deleteUser(uid).catch(() => undefined);
    throw erro;
  }

  return { email, senha, empresaNome: empresa.nome };
}

// Muda o uso de um aparelho já ativado: celular pessoal de um funcionário ou
// aparelho da loja (sem dono), e as empresas que ele atende. Vale na hora no
// servidor e na próxima sincronização da tela do aparelho.
export async function salvarDispositivo(request: CallableRequest) {
  const dados = objeto(request.data);
  const empresaId = idDocumento(dados.empresaId, "Empresa");
  const dispositivoId = idDocumento(dados.dispositivoId, "Aparelho");
  const { usuario } = await exigirAcessoEmpresa(request, empresaId);
  const ref = db.doc(`empresas/${empresaId}/dispositivos/${dispositivoId}`);
  const snap = await ref.get();
  const dispositivo = snap.data();
  if (!dispositivo || dispositivo.ativo !== true) throw new HttpsError("not-found", "Aparelho não encontrado ou desativado.");
  const dono = await donoDoAparelho(empresaId, dados.funcionarioId);
  const atuais = empresasDoAparelho(empresaId, dispositivo).slice(1);
  // Sem a lista no pedido, as empresas atendidas não mudam (a não ser que vire celular pessoal).
  const outras = dono ? await outrasEmpresas(usuario, empresaId, [], atuais) : await outrasEmpresas(usuario, empresaId, dados.empresas ?? atuais, atuais);
  const nomesOutras = (await nomesDasEmpresas(outras)).map((e) => e.nome);

  const lote = db.batch();
  lote.update(ref, { funcionarioId: dono?.id ?? null, funcionarioNome: dono?.nome ?? null, empresas: [empresaId, ...outras] });
  auditarNa(lote, {
    empresaId,
    autor: autor(usuario),
    acao: "dispositivo.uso",
    descricao: dono
      ? `Aparelho "${dispositivo.nome}" passou a ser o celular pessoal de ${dono.nome}.`
      : `Aparelho "${dispositivo.nome}" passou a ser o aparelho da loja (todos os funcionários` +
        `${nomesOutras.length > 0 ? `, também de ${nomesOutras.join(", ")}` : ""}).`,
    detalhes: { dispositivoId, funcionarioId: dono?.id ?? null, empresas: outras },
  });
  await lote.commit();
  return { ok: true };
}

export async function desativarDispositivo(request: CallableRequest) {
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
}

// Chamada periodicamente pelo aparelho: devolve a hora oficial do servidor
// (o relógio do aparelho pode estar errado) e registra que ele está online.
// 1 vCPU: o aparelho sincroniza ao abrir e a cada 5 minutos; com pouca CPU, a
// primeira chamada do dia levava vários segundos só para carregar o código.
export const sincronizarDispositivo = onCall({ cpu: 1, maxInstances: 2 }, async (request) => {
  const { dispositivoId, empresaId } = exigirDispositivo(request);
  const ref = db.doc(`empresas/${empresaId}/dispositivos/${dispositivoId}`);
  const [snap, empresa] = await Promise.all([ref.get(), carregarEmpresa(empresaId)]);
  const dispositivo = snap.data();
  if (!dispositivo || dispositivo.ativo !== true) return { ativo: false, agora: Date.now() };

  const agenteUsuario = String(request.rawRequest.headers["user-agent"] ?? "").slice(0, 200);
  // Estado da câmera (o gestor vê em "Aparelhos de ponto"): aparelho que não abre a câmera não bate ponto.
  const camera = estadoDaCamera((request.data as { camera?: unknown } | null)?.camera);
  await ref.update({
    ultimoSinalEm: FieldValue.serverTimestamp(),
    agenteUsuario,
    ...(camera ? { camera: { ...camera, atualizadaEm: FieldValue.serverTimestamp() } } : {}),
  });
  if (camera?.estado === "erro" && camera.codigo !== dispositivo.camera?.codigo) {
    logger.warn("Câmera com problema no aparelho", { empresaId, dispositivoId, ...camera, agenteUsuario });
  }

  // Celular pessoal: a tela cumprimenta o dono pelo nome (do cadastro atual).
  const [donoSnap, outras] = await Promise.all([
    dispositivo.funcionarioId ? db.doc(`empresas/${empresaId}/funcionarios/${dispositivo.funcionarioId}`).get() : null,
    dispositivo.funcionarioId ? [] : nomesDasEmpresas(empresasDoAparelho(empresaId, dispositivo).slice(1)),
  ]);
  const funcionario = donoSnap?.get("ativo") === true ? { nome: String(donoSnap.get("nome")) } : null;

  const agora = Date.now();
  // Para guardar batidas se a internet cair: a chave pública do servidor e a
  // âncora de horário assinada (ver semInternet.ts). Sem elas, o resto continua.
  const semInternet = await dadosParaSemInternet(dispositivoId, agora).catch((erro: unknown) => {
    logger.error("Falha ao preparar a batida sem internet", { erro });
    return null;
  });
  return {
    ativo: true,
    dispositivo: { id: dispositivoId, nome: dispositivo.nome, funcionario },
    empresa: { id: empresa.id, nome: empresa.nome, fusoHorario: empresa.fusoHorario, ativo: empresa.ativo },
    /** Todas as empresas cujos funcionários batem ponto aqui (a do aparelho primeiro). */
    empresas: [{ id: empresa.id, nome: empresa.nome }, ...outras],
    agora,
    semInternet,
  };
});

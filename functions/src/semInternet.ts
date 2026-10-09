import { constants, createDecipheriv, createHmac, generateKeyPair, privateDecrypt, randomBytes, timingSafeEqual } from "node:crypto";
import { FieldValue, Timestamp, type DocumentData } from "firebase-admin/firestore";
import { HttpsError, onCall } from "firebase-functions/https";
import * as logger from "firebase-functions/logger";
import { db } from "./admin";
import { carregarEmpresa, exigirDispositivo } from "./acesso";
import { registrarAuditoria } from "./auditoria";
import { decodificarJpeg, identificarNoAparelho, lerCpfPin, MAX_MINIATURA_BYTES, type Identificacao } from "./identificacao";
import { comprovante, guardarFoto, MAX_FOTO_BYTES, montarMarcacao, ordinalNoDia, type SemInternetRegistro } from "./marcacao";
import { dataLocal, horaLocal } from "./tempo";
import { objeto } from "./validacao";

// Batida feita sem internet: o aparelho guarda a batida (matrícula, PIN e foto)
// cifrada e a envia sozinho quando a conexão volta. Aqui ela é conferida como
// qualquer batida (PIN, bloqueios, intervalo mínimo) e entra na cadeia de
// hashes marcada como "sem internet".
//
// Segurança:
//  - O aparelho só tem a chave PÚBLICA do servidor: o que fica guardado nele
//    (PIN e foto) só o servidor consegue abrir.
//  - Horário: a cada sincronização o servidor entrega uma "âncora" assinada
//    (a hora dele naquele momento). Sem internet, o aparelho conta o tempo
//    decorrido desde a âncora com um relógio que não muda quando alguém mexe
//    no relógio do aparelho. O horário só é aceito entre a última conexão e a
//    chegada da batida (até 72 h). Se o relógio do aparelho não bater com o
//    tempo decorrido, a batida entra marcada "conferir horário" para o gestor.
//  - O aparelho limita quantas batidas guarda por matrícula, e cada PIN errado
//    conta nos bloqueios de sempre: não dá para testar PINs sem internet.

export const MAX_HORAS_SEM_INTERNET = 72;
/** Diferença tolerada entre o relógio do aparelho e o tempo decorrido. */
const DIVERGENCIA_MAXIMA_MS = 2 * 60_000;
/** Folga para a latência da sincronização e pequenas diferenças de relógio. */
const FOLGA_MS = 60_000;
const MAX_PACOTE_BASE64 = 1_200_000;

// --- Chaves do servidor --------------------------------------------------------
// Um par de chaves RSA (o aparelho recebe só a pública) e um segredo para
// assinar as âncoras de horário. Ficam num documento que nenhum navegador lê
// (ver firestore.rules) e são criados na primeira sincronização de um aparelho.

interface Chaves {
  privada: string;
  publica: string;
  segredoAncora: Buffer;
}

let chaves: Promise<Chaves> | null = null;

export function obterChaves(): Promise<Chaves> {
  chaves ??= carregarOuCriarChaves().catch((erro: unknown) => {
    chaves = null;
    throw erro;
  });
  return chaves;
}

function gerarParDeChaves(): Promise<{ publica: string; privada: string }> {
  return new Promise((resolve, reject) =>
    generateKeyPair(
      "rsa",
      { modulusLength: 3072, publicKeyEncoding: { type: "spki", format: "der" }, privateKeyEncoding: { type: "pkcs8", format: "pem" } },
      (erro, publica, privada) => (erro ? reject(erro) : resolve({ publica: publica.toString("base64"), privada })),
    ),
  );
}

async function carregarOuCriarChaves(): Promise<Chaves> {
  const ref = db.doc("sistema/semInternet");
  let snap = await ref.get();
  if (!snap.exists) {
    const { publica, privada } = await gerarParDeChaves();
    try {
      await ref.create({ publica, privada, segredoAncora: randomBytes(32).toString("base64"), criadoEm: FieldValue.serverTimestamp() });
    } catch (erro) {
      // Outra cópia da função criou ao mesmo tempo (ALREADY_EXISTS): vale a que foi gravada.
      if ((erro as { code?: number }).code !== 6) throw erro;
    }
    snap = await ref.get();
  }
  const d = snap.data()!;
  return { privada: String(d.privada), publica: String(d.publica), segredoAncora: Buffer.from(String(d.segredoAncora), "base64") };
}

// --- Âncora de horário -----------------------------------------------------------

export interface Ancora {
  em: number;
  assinatura: string;
}

function assinarAncora(segredo: Buffer, dispositivoId: string, em: number): string {
  return createHmac("sha256", segredo).update(`${dispositivoId}|${em}`).digest("base64url");
}

export function criarAncora(segredo: Buffer, dispositivoId: string, em: number): Ancora {
  return { em, assinatura: assinarAncora(segredo, dispositivoId, em) };
}

export function ancoraValida(segredo: Buffer, dispositivoId: string, valor: unknown): valor is Ancora {
  const ancora = valor as Partial<Ancora> | null;
  if (!ancora || !Number.isSafeInteger(ancora.em) || typeof ancora.assinatura !== "string") return false;
  const esperada = Buffer.from(assinarAncora(segredo, dispositivoId, ancora.em!));
  const recebida = Buffer.from(ancora.assinatura);
  return esperada.length === recebida.length && timingSafeEqual(esperada, recebida);
}

/** O que o aparelho recebe na sincronização para poder guardar batidas sem internet. */
export async function dadosParaSemInternet(dispositivoId: string, agora: number) {
  const { publica, segredoAncora } = await obterChaves();
  return { chavePublica: publica, ancora: criarAncora(segredoAncora, dispositivoId, agora) };
}

// --- Pacote cifrado -------------------------------------------------------------
// Cifragem híbrida (a mesma do navegador, Web Crypto): os dados vão cifrados
// com AES-256-GCM e a chave AES vai cifrada com RSA-OAEP (SHA-256).

export function abrirPacote(privada: string, valor: unknown): Record<string, unknown> {
  const p = valor as { versao?: unknown; chave?: unknown; iv?: unknown; dados?: unknown } | null;
  if (!p || p.versao !== 1 || typeof p.chave !== "string" || typeof p.iv !== "string" || typeof p.dados !== "string") {
    throw new Error("Pacote em formato desconhecido.");
  }
  if (p.dados.length > MAX_PACOTE_BASE64) throw new Error("Pacote grande demais.");
  const chaveAes = privateDecrypt({ key: privada, padding: constants.RSA_PKCS1_OAEP_PADDING, oaepHash: "sha256" }, Buffer.from(p.chave, "base64"));
  const iv = Buffer.from(p.iv, "base64");
  const cifrado = Buffer.from(p.dados, "base64");
  if (chaveAes.length !== 32 || iv.length !== 12 || cifrado.length <= 16) throw new Error("Pacote inválido.");
  const decifrador = createDecipheriv("aes-256-gcm", chaveAes, iv);
  decifrador.setAuthTag(cifrado.subarray(cifrado.length - 16));
  const texto = Buffer.concat([decifrador.update(cifrado.subarray(0, cifrado.length - 16)), decifrador.final()]).toString("utf8");
  const conteudo: unknown = JSON.parse(texto);
  if (typeof conteudo !== "object" || conteudo === null || Array.isArray(conteudo)) throw new Error("Pacote inválido.");
  return conteudo as Record<string, unknown>;
}

// --- Horário da batida -------------------------------------------------------------

export interface DadosDeHorario {
  /** Hora do servidor na âncora (última conexão do aparelho). */
  ancoraEm: number;
  /** Relógio do aparelho quando recebeu a âncora e na hora da batida. */
  relogioNaAncora: number;
  relogioAgora: number;
  /** Tempo decorrido desde a âncora pelo relógio contínuo do navegador; null se a página foi reaberta. */
  decorrido: number | null;
  /** Quando a batida chegou ao servidor. */
  recebidoEm: number;
}

export type AvaliacaoDeHorario =
  | { aceito: true; horario: number; conferir: boolean; motivo: string | null; porRelogio: number; porDecorrido: number | null }
  | { aceito: false; motivo: string };

/**
 * Apura o horário da batida. O tempo decorrido desde a âncora vale mais que o
 * relógio do aparelho (que alguém pode mudar); se os dois não baterem, a
 * batida entra marcada para conferência.
 */
export function avaliarHorario(d: DadosDeHorario): AvaliacaoDeHorario {
  const porRelogio = d.ancoraEm + (d.relogioAgora - d.relogioNaAncora);
  const porDecorrido = d.decorrido === null ? null : d.ancoraEm + d.decorrido;
  let horario: number;
  let motivo: string | null = null;
  if (porDecorrido === null) {
    horario = porRelogio;
    motivo = "O aparelho foi reiniciado sem internet: horário pelo relógio do aparelho.";
  } else if (porRelogio < porDecorrido - DIVERGENCIA_MAXIMA_MS || porRelogio > d.recebidoEm + FOLGA_MS) {
    // O tempo decorrido não volta para trás: com o relógio atrasado (ou no futuro), vale ele.
    horario = porDecorrido;
    motivo = "O relógio do aparelho foi mudado: horário pelo tempo decorrido desde a última conexão.";
  } else if (porRelogio > porDecorrido + DIVERGENCIA_MAXIMA_MS) {
    // Relógio à frente do tempo decorrido: o aparelho pode ter entrado em repouso
    // (o tempo decorrido para) ou alguém adiantou o relógio.
    horario = porRelogio;
    motivo = "O relógio do aparelho andou mais que o tempo decorrido desde a última conexão (aparelho em repouso ou relógio adiantado).";
  } else {
    horario = porDecorrido;
  }

  if (horario < d.ancoraEm - FOLGA_MS) return { aceito: false, motivo: "horário anterior à última conexão do aparelho com o servidor." };
  if (horario > d.recebidoEm + FOLGA_MS) return { aceito: false, motivo: "horário no futuro." };
  if (d.recebidoEm - horario > MAX_HORAS_SEM_INTERNET * 3_600_000) {
    return { aceito: false, motivo: `feita há mais de ${MAX_HORAS_SEM_INTERNET} horas; se for o caso, inclua a marcação pelo painel.` };
  }
  return { aceito: true, horario: Math.round(horario), conferir: motivo !== null, motivo, porRelogio, porDecorrido };
}

function numero(valor: unknown, minimo = 0): number | null {
  return typeof valor === "number" && Number.isFinite(valor) && valor >= minimo && valor < 1e15 ? valor : null;
}

const dataHoraBR = (data: Date, fuso: string) => `${dataLocal(data, fuso).split("-").reverse().join("/")} ${horaLocal(data, fuso).slice(0, 5)}`;

// --- Envio da batida guardada ---------------------------------------------------------

type ResultadoEnvio =
  | { resultado: "registrada"; conferir: boolean; comprovante: ReturnType<typeof comprovante> }
  | { resultado: "duplicada"; motivo: string }
  | { resultado: "recusada"; motivo: string };

/**
 * Recebe uma batida guardada sem internet. Recusas definitivas (PIN errado,
 * horário fora da janela...) voltam como resultado, para o aparelho tirá-las da
 * fila; erros temporários (bloqueio, falha de rede) voltam como erro, e o
 * aparelho tenta de novo depois.
 */
export const registrarPontoGuardado = onCall({ memory: "512MiB", maxInstances: 2 }, async (request): Promise<ResultadoEnvio> => {
  const { dispositivoId, empresaId } = exigirDispositivo(request);
  const recebidoEm = Date.now();
  const empresaRef = db.doc(`empresas/${empresaId}`);
  const dispositivoRef = empresaRef.collection("dispositivos").doc(dispositivoId);
  const [{ privada, segredoAncora }, empresa, dispositivoSnap] = await Promise.all([obterChaves(), carregarEmpresa(empresaId), dispositivoRef.get()]);
  const dispositivo = dispositivoSnap.data();
  // Aparelho desativado não envia nada: as batidas ficam nele e o gestor lança pelo painel, se for o caso.
  if (!dispositivo || dispositivo.ativo !== true) {
    throw new HttpsError("permission-denied", "Este aparelho foi desativado. Peça ao gestor para ativá-lo novamente.");
  }
  const dispositivoNome = String(dispositivo.nome ?? "");
  const fuso = empresa.fusoHorario;

  const recusar = async (motivo: string, extra: { horario?: number; miniatura?: Buffer | null } = {}): Promise<ResultadoEnvio> => {
    const quando = extra.horario ? ` de ${dataHoraBR(new Date(extra.horario), fuso)}` : "";
    logger.warn("Batida sem internet recusada", { empresaId, dispositivoId, motivo });
    await registrarAuditoria({
      empresaId,
      autor: { uid: dispositivoId, nome: `Aparelho "${dispositivoNome}"` },
      acao: "ponto.semInternetRecusado",
      descricao: `Batida feita sem internet${quando} no aparelho "${dispositivoNome}" recusada: ${motivo}`,
      detalhes: {
        dispositivoId,
        horario: extra.horario ? Timestamp.fromMillis(extra.horario) : null,
        motivo,
        foto: extra.miniatura ? `data:image/jpeg;base64,${extra.miniatura.toString("base64")}` : null,
      },
    });
    return { resultado: "recusada", motivo };
  };

  let conteudo: Record<string, unknown>;
  try {
    conteudo = abrirPacote(privada, objeto(request.data).pacote);
  } catch {
    return recusar("os dados da batida não puderam ser lidos.");
  }
  if (conteudo.dispositivoId !== dispositivoId) return recusar("a batida foi guardada em outro aparelho.");

  const h = (conteudo.horario ?? {}) as Record<string, unknown>;
  const ancora = h.ancora;
  const relogioNaAncora = numero(h.relogioNaAncora);
  const relogioAgora = numero(h.relogioAgora);
  const decorrido = h.decorrido === null ? null : numero(h.decorrido);
  const horarioValido = relogioNaAncora !== null && relogioAgora !== null && (h.decorrido === null || decorrido !== null);
  if (!ancoraValida(segredoAncora, dispositivoId, ancora) || !horarioValido) return recusar("o horário não tem a confirmação do servidor.");

  const idRequisicao = typeof conteudo.idRequisicao === "string" ? conteudo.idRequisicao : "";
  if (!/^[A-Za-z0-9-]{16,64}$/.test(idRequisicao)) return recusar("a identificação da batida é inválida.");
  let cpf: string | null, pin: string, foto: Buffer, miniatura: Buffer;
  try {
    ({ cpf, pin } = lerCpfPin(conteudo));
    miniatura = decodificarJpeg(conteudo.miniatura, "Miniatura da foto", MAX_MINIATURA_BYTES);
    foto = decodificarJpeg(conteudo.foto, "Foto", MAX_FOTO_BYTES);
  } catch {
    return recusar("o CPF, o PIN ou a foto vieram em formato inválido.");
  }

  const avaliacao = avaliarHorario({ ancoraEm: ancora.em, relogioNaAncora, relogioAgora, decorrido, recebidoEm });
  if (!avaliacao.aceito) {
    return recusar(avaliacao.motivo, { miniatura, horario: ancora.em + (relogioAgora - relogioNaAncora) });
  }
  const extra = { miniatura, horario: avaliacao.horario };
  if (!empresa.ativo) return recusar("a empresa está desativada.", extra);

  // PIN conferido como numa batida online, com os mesmos bloqueios.
  let identificacao: Identificacao;
  try {
    identificacao = await identificarNoAparelho({ empresaId, dispositivoId, cpf, pin, miniatura });
  } catch (erro) {
    const motivo = (erro as { details?: { motivo?: string } }).details?.motivo;
    if (motivo === "credenciais-invalidas") return recusar("CPF ou PIN incorretos.", extra);
    // Bloqueio temporário ou falha: a batida continua guardada e vai de novo depois.
    throw erro;
  }
  const { funcionarioId, funcionario, credenciaisRef } = identificacao;

  const dataHora = new Date(avaliacao.horario);
  const dia = dataLocal(dataHora, fuso);
  const registroRef = empresaRef.collection("registros").doc(idRequisicao);
  const vizinhos = [-86_400_000, 0, 86_400_000].map((d) => dataLocal(new Date(avaliacao.horario + d), fuso));
  const [registroSnap, doFuncionario] = await Promise.all([
    registroRef.get(),
    empresaRef
      .collection("registros")
      .where("funcionarioId", "==", funcionarioId)
      .where("dataLocal", "in", [...new Set(vizinhos)])
      .select("dataHora", "dataLocal", "desconsiderado")
      .get(),
  ]);
  const doDia = (registro: DocumentData) => doFuncionario.docs.filter((doc) => doc.get("dataLocal") === registro.dataLocal);

  // Já gravada (ex.: a batida chegou ao servidor, mas a resposta se perdeu): devolve o mesmo comprovante.
  if (registroSnap.exists) {
    const existente = registroSnap.data()!;
    if (existente.dispositivoId !== dispositivoId || existente.funcionarioId !== funcionarioId) {
      return recusar("a identificação da batida já pertence a outra marcação.", extra);
    }
    const ordinal = ordinalNoDia(doDia(existente), registroRef.id, (existente.dataHora as Timestamp).toMillis());
    return { resultado: "registrada", conferir: existente.semInternet?.conferir === true, comprovante: comprovante(registroRef.id, existente, ordinal, empresa.nome) };
  }

  // Batida repetida: o funcionário já tem outra marcação a menos do intervalo mínimo.
  const intervaloMs = empresa.intervaloMinimoMinutos * 60_000;
  const repetida = doFuncionario.docs.some(
    (doc) => !doc.get("desconsiderado") && Math.abs((doc.get("dataHora") as Timestamp).toMillis() - avaliacao.horario) < intervaloMs,
  );
  if (repetida) {
    logger.info("Batida sem internet repetida", { empresaId, dispositivoId, funcionarioId });
    return { resultado: "duplicada", motivo: `${funcionario.nome} já tinha uma marcação a menos de ${empresa.intervaloMinimoMinutos} min.` };
  }

  const { fotoPath, fotoSha256, apagar } = await guardarFoto({ empresaId, registroId: registroRef.id, dataLocal: dia, foto, funcionarioId, dispositivoId });
  const semInternet: SemInternetRegistro = {
    recebidoEm: new Date(recebidoEm),
    conferir: avaliacao.conferir,
    motivo: avaliacao.motivo,
    horarioRelogio: new Date(Math.round(avaliacao.porRelogio)),
    horarioDecorrido: avaliacao.porDecorrido === null ? null : new Date(Math.round(avaliacao.porDecorrido)),
    ultimaConexaoEm: new Date(ancora.em),
  };

  let resultado: { registro: DocumentData; duplicado: boolean };
  try {
    resultado = await db.runTransaction(async (tx) => {
      const controleRef = empresaRef.collection("privado").doc("controle");
      const [controleSnap, credenciais, registroAtual, dispositivoAtual] = await Promise.all([
        tx.get(controleRef),
        tx.get(credenciaisRef),
        tx.get(registroRef),
        tx.get(dispositivoRef),
      ]);
      if (registroAtual.exists) return { registro: registroAtual.data()!, duplicado: true };

      const { registro, contador } = montarMarcacao(controleSnap, {
        empresaId,
        funcionarioId,
        funcionario,
        dispositivoId,
        dispositivoNome,
        dataHora,
        fuso,
        fotoPath,
        fotoSha256,
        miniatura,
        semInternet,
      });
      tx.create(registroRef, registro);
      tx.set(controleRef, contador, { merge: true });
      // "Última marcação" (base do intervalo mínimo) e "último registro" só avançam, nunca voltam.
      const ultimaMarcacao = (credenciais.get("ultimaMarcacaoEm") as Timestamp | null | undefined)?.toMillis() ?? 0;
      if (avaliacao.horario > ultimaMarcacao) tx.update(credenciaisRef, { ultimaMarcacaoEm: registro.dataHora });
      const ultimoRegistro = (dispositivoAtual.get("ultimoRegistroEm") as Timestamp | null | undefined)?.toMillis() ?? 0;
      tx.update(dispositivoRef, {
        ultimoSinalEm: FieldValue.serverTimestamp(),
        ...(avaliacao.horario > ultimoRegistro ? { ultimoRegistroEm: registro.dataHora } : {}),
      });
      return { registro, duplicado: false };
    });
  } catch (erro) {
    await apagar();
    throw erro;
  }
  if (resultado.duplicado) {
    await apagar();
  } else {
    logger.info("Batida sem internet registrada", { empresaId, funcionarioId, dispositivoId, nsr: resultado.registro.nsr, conferir: avaliacao.conferir });
    if (avaliacao.conferir) {
      await registrarAuditoria({
        empresaId,
        autor: { uid: dispositivoId, nome: `Aparelho "${dispositivoNome}"` },
        acao: "ponto.horarioConferir",
        descricao: `Batida de ${funcionario.nome} feita sem internet em ${dataHoraBR(dataHora, fuso)} no aparelho "${dispositivoNome}": ${avaliacao.motivo} Confira o horário.`,
        detalhes: {
          registroId: registroRef.id,
          funcionarioId,
          horarioRelogio: Timestamp.fromDate(semInternet.horarioRelogio),
          horarioDecorrido: semInternet.horarioDecorrido ? Timestamp.fromDate(semInternet.horarioDecorrido) : null,
        },
      });
    }
  }
  const ordinal = ordinalNoDia(doDia(resultado.registro), registroRef.id, avaliacao.horario);
  return { resultado: "registrada", conferir: avaliacao.conferir, comprovante: comprovante(registroRef.id, resultado.registro, ordinal, empresa.nome) };
});

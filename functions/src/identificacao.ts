import { Timestamp, type DocumentData, type DocumentReference } from "firebase-admin/firestore";
import { HttpsError } from "firebase-functions/https";
import * as logger from "firebase-functions/logger";
import { db } from "./admin";
import { carregarEmpresa, type Empresa } from "./acesso";
import { registrarAuditoria } from "./auditoria";
import { simularConferenciaPin, verificarPin } from "./seguranca";
import { normalizarMatricula } from "./validacao";

// Identificação do funcionário no aparelho de ponto (matrícula + PIN), usada
// para bater o ponto, pedir marcação esquecida, assinar o espelho e criar o
// PIN pessoal.
//
// Proteção contra adivinhação de PIN:
//  - por funcionário: 5 erros seguidos bloqueiam a matrícula por 15 minutos;
//    cada novo bloqueio sem um acerto no meio dobra o tempo (até 1 hora);
//  - por aparelho: 25 erros em 15 minutos bloqueiam o aparelho até a janela passar;
//  - cada tentativa é RESERVADA numa transação antes de o PIN ser conferido:
//    pedidos disparados em paralelo não testam mais PINs do que o limite;
//  - todo bloqueio vai para a auditoria da empresa, com a foto da tentativa;
//  - matrícula inexistente gasta o mesmo tempo de um PIN errado, então o tempo
//    de resposta não revela quais matrículas existem.
export const MAX_FALHAS_PIN = 5;
export const MAX_FALHAS_APARELHO = 25;
const JANELA_FALHAS_APARELHO_MS = 15 * 60_000;
const BLOQUEIO_INICIAL_MIN = 15;
const BLOQUEIO_MAXIMO_MIN = 60;

export const MAX_MINIATURA_BYTES = 16 * 1024;

/** Duração do n-ésimo bloqueio seguido de uma matrícula: 15, 30, 60, 60... minutos. */
export function minutosDeBloqueio(bloqueiosSeguidos: number): number {
  return Math.min(BLOQUEIO_INICIAL_MIN * 2 ** Math.max(0, bloqueiosSeguidos - 1), BLOQUEIO_MAXIMO_MIN);
}

export function credenciaisInvalidas(): HttpsError {
  return new HttpsError("permission-denied", "Matrícula ou PIN inválidos.", { motivo: "credenciais-invalidas" });
}

/** O PIN usado é o provisório definido pelo gestor: o funcionário precisa criar o dele. */
export function erroPinProvisorio(): HttpsError {
  return new HttpsError("failed-precondition", "Primeiro acesso: crie o seu PIN pessoal para continuar.", {
    motivo: "pin-provisorio",
  });
}

/** Matrícula e PIN no formato do teclado do aparelho; formato errado conta como credencial inválida. */
export function lerMatriculaPin(dados: Record<string, unknown>): { matricula: string; pin: string } {
  if (typeof dados.matricula !== "string" || !/^\d{1,10}$/.test(dados.matricula)) throw credenciaisInvalidas();
  if (typeof dados.pin !== "string" || !/^\d{4,6}$/.test(dados.pin)) throw credenciaisInvalidas();
  return { matricula: normalizarMatricula(dados.matricula), pin: dados.pin };
}

export function decodificarJpeg(valor: unknown, campo: string, maxBytes: number): Buffer {
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

interface JanelaFalhas {
  inicio: Timestamp;
  quantidade: number;
}

function janelaVigente(valor: unknown, agora: number): JanelaFalhas | null {
  const janela = valor as JanelaFalhas | undefined;
  if (!janela?.inicio || agora - janela.inicio.toMillis() > JANELA_FALHAS_APARELHO_MS) return null;
  return janela;
}

function erroAparelhoBloqueado(): HttpsError {
  return new HttpsError("resource-exhausted", "Muitas tentativas inválidas neste aparelho. Aguarde alguns minutos.");
}

function erroMatriculaBloqueada(ate: number): HttpsError {
  const minutos = Math.max(1, Math.ceil((ate - Date.now()) / 60_000));
  return new HttpsError(
    "resource-exhausted",
    `Muitas tentativas incorretas. Tente novamente em ${minutos} min ou peça ao gestor para redefinir seu PIN.`,
  );
}

/** Confere se o aparelho e a empresa podem receber registros agora. */
export function exigirAparelhoAtivo(dispositivo: DocumentData | undefined, empresa: Empresa): DocumentData {
  if (!dispositivo || dispositivo.ativo !== true) {
    throw new HttpsError("permission-denied", "Este aparelho foi desativado. Peça ao gestor para ativá-lo novamente.");
  }
  if (!empresa.ativo) throw new HttpsError("failed-precondition", "Empresa desativada. Procure o gestor.");
  const falhas = janelaVigente(dispositivo.falhas, Date.now());
  if (falhas && falhas.quantidade >= MAX_FALHAS_APARELHO) throw erroAparelhoBloqueado();
  return dispositivo;
}

interface Reserva {
  credenciais: DocumentData | null;
  /** Início da janela de erros do aparelho em que esta tentativa foi contada. */
  janelaAparelho: number;
  /** Minutos de bloqueio que esta tentativa aplica à matrícula, se errar. */
  bloqueioMatriculaMin: number | null;
  /** Esta tentativa, se errar, completa o limite de erros do aparelho. */
  bloqueiaAparelho: boolean;
}

/**
 * Conta a tentativa como erro ANTES de conferir o PIN, numa transação. Se o PIN
 * estiver certo, confirmarAcerto desfaz a contagem. Assim o limite vale mesmo
 * para tentativas simultâneas.
 */
function reservarTentativa(dispositivoRef: DocumentReference, credenciaisRef: DocumentReference | null): Promise<Reserva> {
  return db.runTransaction(async (tx) => {
    const [dispositivoSnap, credenciaisSnap] = await Promise.all([
      tx.get(dispositivoRef),
      credenciaisRef ? tx.get(credenciaisRef) : Promise.resolve(null),
    ]);
    const agora = Date.now();

    const janela = janelaVigente(dispositivoSnap.get("falhas"), agora);
    if (janela && janela.quantidade >= MAX_FALHAS_APARELHO) throw erroAparelhoBloqueado();

    const credenciais = credenciaisSnap?.data() ?? null;
    let bloqueioMatriculaMin: number | null = null;
    if (credenciaisRef && credenciais) {
      const bloqueadoAte = (credenciais.bloqueadoAte as Timestamp | null | undefined)?.toMillis() ?? 0;
      if (bloqueadoAte > agora) throw erroMatriculaBloqueada(bloqueadoAte);
      const falhas = ((credenciais.falhas as number | undefined) ?? 0) + 1;
      if (falhas >= MAX_FALHAS_PIN) {
        const bloqueios = ((credenciais.bloqueios as number | undefined) ?? 0) + 1;
        bloqueioMatriculaMin = minutosDeBloqueio(bloqueios);
        tx.update(credenciaisRef, {
          falhas: 0,
          bloqueios,
          bloqueadoAte: Timestamp.fromMillis(agora + bloqueioMatriculaMin * 60_000),
        });
      } else {
        tx.update(credenciaisRef, { falhas });
      }
    }

    const inicio = janela?.inicio ?? Timestamp.fromMillis(agora);
    const quantidade = (janela?.quantidade ?? 0) + 1;
    tx.update(dispositivoRef, { falhas: { inicio, quantidade } });

    return { credenciais, janelaAparelho: inicio.toMillis(), bloqueioMatriculaMin, bloqueiaAparelho: quantidade >= MAX_FALHAS_APARELHO };
  });
}

/** PIN certo: zera os erros da matrícula e devolve a tentativa reservada no aparelho. */
async function confirmarAcerto(dispositivoRef: DocumentReference, credenciaisRef: DocumentReference, janelaAparelho: number) {
  await db.runTransaction(async (tx) => {
    const janela = (await tx.get(dispositivoRef)).get("falhas") as JanelaFalhas | undefined;
    if (janela?.inicio?.toMillis() === janelaAparelho && janela.quantidade > 0) {
      tx.update(dispositivoRef, { "falhas.quantidade": janela.quantidade - 1 });
    }
    tx.update(credenciaisRef, { falhas: 0, bloqueios: 0, bloqueadoAte: null });
  });
}

async function auditarBloqueios(params: {
  reserva: Reserva;
  empresaId: string;
  dispositivoId: string;
  dispositivoNome: string;
  matricula: string;
  funcionarioId: string | null;
  funcionarioNome: string | null;
  miniatura: Buffer | null;
}) {
  const { reserva, empresaId, dispositivoId, dispositivoNome, matricula, funcionarioId, funcionarioNome, miniatura } = params;
  const autor = { uid: dispositivoId, nome: `Aparelho "${dispositivoNome}"` };
  const foto = miniatura ? `data:image/jpeg;base64,${miniatura.toString("base64")}` : null;
  if (reserva.bloqueioMatriculaMin && funcionarioId) {
    await registrarAuditoria({
      empresaId,
      autor,
      acao: "pin.bloqueado",
      descricao:
        `Matrícula ${matricula} (${funcionarioNome}) bloqueada por ${reserva.bloqueioMatriculaMin} min depois de ` +
        `${MAX_FALHAS_PIN} PINs errados seguidos no aparelho "${dispositivoNome}".`,
      detalhes: { funcionarioId, dispositivoId, minutos: reserva.bloqueioMatriculaMin, foto },
    });
  }
  if (reserva.bloqueiaAparelho) {
    await registrarAuditoria({
      empresaId,
      autor,
      acao: "aparelho.bloqueado",
      descricao: `Aparelho "${dispositivoNome}" bloqueado por 15 min depois de ${MAX_FALHAS_APARELHO} tentativas inválidas (a última com a matrícula ${matricula}).`,
      detalhes: { dispositivoId, matricula, foto },
    });
  }
}

export interface Identificacao {
  empresa: Empresa;
  empresaRef: DocumentReference;
  dispositivoRef: DocumentReference;
  dispositivo: DocumentData;
  funcionarioId: string;
  funcionario: DocumentData;
  credenciaisRef: DocumentReference;
  /** O PIN usado é o provisório definido pelo gestor. */
  provisorio: boolean;
}

/**
 * Identificação completa no aparelho: aparelho ativo, funcionário ativo com a
 * matrícula informada e PIN certo. O PIN provisório só é aceito para criar o
 * PIN pessoal (aceitarProvisorio).
 */
export async function identificarNoAparelho(params: {
  empresaId: string;
  dispositivoId: string;
  matricula: string;
  pin: string;
  /** Foto pequena da tentativa: vai para a auditoria se a tentativa causar bloqueio. */
  miniatura?: Buffer | null;
  aceitarProvisorio?: boolean;
}): Promise<Identificacao> {
  const { empresaId, dispositivoId, matricula, pin, miniatura = null, aceitarProvisorio = false } = params;
  const empresaRef = db.doc(`empresas/${empresaId}`);
  const dispositivoRef = empresaRef.collection("dispositivos").doc(dispositivoId);
  const [empresa, dispositivoSnap, encontrados] = await Promise.all([
    carregarEmpresa(empresaId),
    dispositivoRef.get(),
    empresaRef.collection("funcionarios").where("matricula", "==", matricula).limit(1).get(),
  ]);
  const dispositivo = exigirAparelhoAtivo(dispositivoSnap.data(), empresa);

  const funcionarioDoc = encontrados.docs[0];
  const funcionario = funcionarioDoc?.get("ativo") === true ? funcionarioDoc.data() : null;
  const funcionarioId = funcionario ? funcionarioDoc.id : null;
  const credenciaisRef = funcionarioId ? empresaRef.collection("credenciais").doc(funcionarioId) : null;

  const reserva = await reservarTentativa(dispositivoRef, credenciaisRef);
  const credenciais = reserva.credenciais;

  let acertou = false;
  if (funcionario && credenciais?.pinHash) {
    acertou = await verificarPin(pin, credenciais.pinHash, credenciais.pinSal);
  } else {
    await simularConferenciaPin(pin);
  }

  if (!acertou || !funcionario || !funcionarioId || !credenciaisRef || !credenciais) {
    logger.warn("Matrícula ou PIN inválidos no aparelho", { empresaId, dispositivoId, funcionarioId });
    await auditarBloqueios({
      reserva,
      empresaId,
      dispositivoId,
      dispositivoNome: String(dispositivo.nome ?? ""),
      matricula,
      funcionarioId,
      funcionarioNome: funcionario ? String(funcionario.nome) : null,
      miniatura,
    });
    throw credenciaisInvalidas();
  }

  await confirmarAcerto(dispositivoRef, credenciaisRef, reserva.janelaAparelho);
  const provisorio = credenciais.provisorio === true;
  if (provisorio && !aceitarProvisorio) throw erroPinProvisorio();
  return { empresa, empresaRef, dispositivoRef, dispositivo, funcionarioId, funcionario, credenciaisRef, provisorio };
}

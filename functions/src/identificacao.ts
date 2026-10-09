import { Timestamp, type DocumentData, type DocumentReference } from "firebase-admin/firestore";
import { HttpsError } from "firebase-functions/https";
import * as logger from "firebase-functions/logger";
import { db } from "./admin";
import { carregarEmpresa, type Empresa } from "./acesso";
import { registrarAuditoria } from "./auditoria";
import { pinConfere } from "./pin";
import { cpfValido } from "./validacao";

// Identificação do funcionário no aparelho de ponto: no aparelho da loja, CPF +
// PIN de 4 números (definido pelo gestor); no celular pessoal, só o PIN (o
// aparelho já identifica o dono). Usada para bater o ponto, com ou sem internet.
//
// Proteção contra adivinhação de PIN:
//  - por funcionário: 5 erros seguidos bloqueiam o PIN por 15 minutos; cada novo
//    bloqueio sem um acerto no meio dobra o tempo (até 1 hora);
//  - por aparelho: 25 erros em 15 minutos bloqueiam o aparelho até a janela passar;
//  - cada tentativa é RESERVADA numa transação antes de o PIN ser conferido:
//    pedidos disparados em paralelo não testam mais PINs do que o limite;
//  - todo bloqueio vai para a auditoria da empresa, com a foto da tentativa;
//  - CPF que não é de funcionário ativo e PIN errado dão a mesma resposta.
export const MAX_FALHAS_PIN = 5;
export const MAX_FALHAS_APARELHO = 25;
const JANELA_FALHAS_APARELHO_MS = 15 * 60_000;
const BLOQUEIO_INICIAL_MIN = 15;
const BLOQUEIO_MAXIMO_MIN = 60;

export const MAX_MINIATURA_BYTES = 16 * 1024;

/** Duração do n-ésimo bloqueio seguido de um funcionário: 15, 30, 60, 60... minutos. */
export function minutosDeBloqueio(bloqueiosSeguidos: number): number {
  return Math.min(BLOQUEIO_INICIAL_MIN * 2 ** Math.max(0, bloqueiosSeguidos - 1), BLOQUEIO_MAXIMO_MIN);
}

export function credenciaisInvalidas(): HttpsError {
  return new HttpsError("permission-denied", "CPF ou PIN incorretos.", { motivo: "credenciais-invalidas" });
}

/**
 * A tela antiga do aparelho (até 09/10/2026) mandava a matrícula, nunca o CPF.
 * Aberta desde antes da atualização, ela mostraria um erro de matrícula; em vez
 * disso, a pessoa vê que precisa recarregar (o aparelho também se atualiza
 * sozinho quando fica parado). Não conta como tentativa errada.
 */
export function erroVersaoAntiga(): HttpsError {
  return new HttpsError(
    "failed-precondition",
    "Este aparelho está com a versão antiga do ponto, que pedia a matrícula. Recarregue a página: agora é CPF e PIN.",
    { motivo: "versao-antiga" },
  );
}

/**
 * CPF (só os números, válido) e PIN de 4 números, do teclado do aparelho. No
 * celular pessoal o CPF não vem. Formato errado conta como credencial inválida.
 */
export function lerCpfPin(dados: Record<string, unknown>): { cpf: string | null; pin: string } {
  const semCpf = dados.cpf === undefined || dados.cpf === null || dados.cpf === "";
  if (semCpf && typeof dados.matricula === "string" && dados.matricula !== "") throw erroVersaoAntiga();
  if (typeof dados.pin !== "string" || !/^\d{4}$/.test(dados.pin)) throw credenciaisInvalidas();
  if (semCpf) return { cpf: null, pin: dados.pin };
  if (typeof dados.cpf !== "string" || !/^\d{11}$/.test(dados.cpf) || !cpfValido(dados.cpf)) throw credenciaisInvalidas();
  return { cpf: dados.cpf, pin: dados.pin };
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
  return new HttpsError("resource-exhausted", "Muitas tentativas erradas neste aparelho. Aguarde alguns minutos.");
}

function erroPinBloqueado(ate: number): HttpsError {
  const minutos = Math.max(1, Math.ceil((ate - Date.now()) / 60_000));
  return new HttpsError(
    "resource-exhausted",
    `Muitas tentativas erradas. Tente de novo em ${minutos} min ou peça ao gestor para trocar o seu PIN.`,
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
  /** Minutos de bloqueio que esta tentativa aplica ao PIN do funcionário, se errar. */
  bloqueioPinMin: number | null;
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
    let bloqueioPinMin: number | null = null;
    if (credenciaisRef && credenciais) {
      const bloqueadoAte = (credenciais.bloqueadoAte as Timestamp | null | undefined)?.toMillis() ?? 0;
      if (bloqueadoAte > agora) throw erroPinBloqueado(bloqueadoAte);
      const falhas = ((credenciais.falhas as number | undefined) ?? 0) + 1;
      if (falhas >= MAX_FALHAS_PIN) {
        const bloqueios = ((credenciais.bloqueios as number | undefined) ?? 0) + 1;
        bloqueioPinMin = minutosDeBloqueio(bloqueios);
        tx.update(credenciaisRef, { falhas: 0, bloqueios, bloqueadoAte: Timestamp.fromMillis(agora + bloqueioPinMin * 60_000) });
      } else {
        tx.update(credenciaisRef, { falhas });
      }
    }

    const inicio = janela?.inicio ?? Timestamp.fromMillis(agora);
    const quantidade = (janela?.quantidade ?? 0) + 1;
    tx.update(dispositivoRef, { falhas: { inicio, quantidade } });

    return { credenciais, janelaAparelho: inicio.toMillis(), bloqueioPinMin, bloqueiaAparelho: quantidade >= MAX_FALHAS_APARELHO };
  });
}

/** PIN certo: zera os erros do funcionário e devolve a tentativa reservada no aparelho. */
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
  funcionarioId: string | null;
  funcionarioNome: string | null;
  miniatura: Buffer | null;
}) {
  const { reserva, empresaId, dispositivoId, dispositivoNome, funcionarioId, funcionarioNome, miniatura } = params;
  const autor = { uid: dispositivoId, nome: `Aparelho "${dispositivoNome}"` };
  const foto = miniatura ? `data:image/jpeg;base64,${miniatura.toString("base64")}` : null;
  if (reserva.bloqueioPinMin && funcionarioId) {
    await registrarAuditoria({
      empresaId,
      autor,
      acao: "pin.bloqueado",
      descricao:
        `PIN de ${funcionarioNome} bloqueado por ${reserva.bloqueioPinMin} min depois de ` +
        `${MAX_FALHAS_PIN} tentativas erradas seguidas no aparelho "${dispositivoNome}".`,
      detalhes: { funcionarioId, dispositivoId, minutos: reserva.bloqueioPinMin, foto },
    });
  }
  if (reserva.bloqueiaAparelho) {
    await registrarAuditoria({
      empresaId,
      autor,
      acao: "aparelho.bloqueado",
      descricao: `Aparelho "${dispositivoNome}" bloqueado por 15 min depois de ${MAX_FALHAS_APARELHO} tentativas erradas.`,
      detalhes: { dispositivoId, foto },
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
  /** Dados do servidor sobre o funcionário (chave do PIN, erros, última marcação). */
  credenciaisRef: DocumentReference;
}

/**
 * Identificação no aparelho: aparelho ativo, funcionário ativo e PIN certo. No
 * aparelho da loja, o funcionário é o dono do CPF; no celular pessoal, é o dono
 * do aparelho (o CPF, se vier, é ignorado).
 */
export async function identificarNoAparelho(params: {
  empresaId: string;
  dispositivoId: string;
  cpf: string | null;
  pin: string;
  /** Foto pequena da tentativa: vai para a auditoria se a tentativa causar bloqueio. */
  miniatura?: Buffer | null;
}): Promise<Identificacao> {
  const { empresaId, dispositivoId, cpf, pin, miniatura = null } = params;
  const empresaRef = db.doc(`empresas/${empresaId}`);
  const dispositivoRef = empresaRef.collection("dispositivos").doc(dispositivoId);
  const [empresa, dispositivoSnap] = await Promise.all([carregarEmpresa(empresaId), dispositivoRef.get()]);
  const dispositivo = exigirAparelhoAtivo(dispositivoSnap.data(), empresa);

  const funcionarios = empresaRef.collection("funcionarios");
  const funcionarioDoc = dispositivo.funcionarioId
    ? await funcionarios.doc(String(dispositivo.funcionarioId)).get()
    : cpf
      ? (await funcionarios.where("cpf", "==", cpf).limit(1).get()).docs[0]
      : undefined;
  const funcionario = funcionarioDoc?.get("ativo") === true ? funcionarioDoc.data() : undefined;
  const funcionarioId = funcionario && funcionarioDoc ? funcionarioDoc.id : null;
  const credenciaisRef = funcionarioId ? empresaRef.collection("credenciais").doc(funcionarioId) : null;

  const reserva = await reservarTentativa(dispositivoRef, credenciaisRef);
  // Sem funcionário, confere um PIN fictício: a resposta não revela se o CPF é de alguém.
  const acertou = await pinConfere(reserva.credenciais?.pinChave, empresaId, funcionarioId ?? "-", pin);

  if (!acertou || !funcionario || !funcionarioId || !credenciaisRef) {
    // O CPF e o PIN nunca vão para o log.
    logger.warn("CPF ou PIN incorretos no aparelho", { empresaId, dispositivoId, funcionarioId });
    await auditarBloqueios({
      reserva,
      empresaId,
      dispositivoId,
      dispositivoNome: String(dispositivo.nome ?? ""),
      funcionarioId,
      funcionarioNome: funcionario ? String(funcionario.nome) : null,
      miniatura,
    });
    throw credenciaisInvalidas();
  }

  await confirmarAcerto(dispositivoRef, credenciaisRef, reserva.janelaAparelho);
  return { empresa, empresaRef, dispositivoRef, dispositivo, funcionarioId, funcionario, credenciaisRef };
}

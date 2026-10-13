import { FieldValue, Timestamp, type DocumentData, type DocumentReference } from "firebase-admin/firestore";
import { HttpsError } from "firebase-functions/https";
import * as logger from "firebase-functions/logger";
import { db } from "./admin";
import { carregarEmpresa, type Empresa } from "./acesso";
import { registrarAuditoria } from "./auditoria";
import { credenciaisComPinAntigo, donosDoPinAntigo, indiceDoPin, mesmaChave } from "./pin";

// Identificação do funcionário no aparelho de ponto: só o PIN de 4 números,
// definido pelo gestor e diferente para cada funcionário da empresa. No celular
// pessoal, só vale o PIN do dono do aparelho. Usada para bater o ponto, com ou
// sem internet.
//
// Proteção contra adivinhação de PIN:
//  - por aparelho: 10 erros em 15 minutos bloqueiam o aparelho até a janela
//    passar. Sem CPF, um chute pode acertar o PIN de qualquer funcionário, então
//    o limite é do aparelho (e toda batida tem a foto de quem bateu);
//  - no celular pessoal, também por funcionário: 5 erros seguidos bloqueiam o
//    PIN do dono por 15 minutos; cada novo bloqueio sem um acerto no meio dobra
//    o tempo (até 1 hora);
//  - cada tentativa é RESERVADA numa transação antes de a resposta sair:
//    pedidos disparados em paralelo não testam mais PINs do que o limite;
//  - todo bloqueio vai para a auditoria da empresa, com a foto da tentativa.
export const MAX_FALHAS_PIN = 5;
export const MAX_FALHAS_APARELHO = 10;
const JANELA_FALHAS_APARELHO_MS = 15 * 60_000;
const BLOQUEIO_INICIAL_MIN = 15;
const BLOQUEIO_MAXIMO_MIN = 60;

export const MAX_MINIATURA_BYTES = 16 * 1024;

/** Duração do n-ésimo bloqueio seguido de um funcionário: 15, 30, 60, 60... minutos. */
export function minutosDeBloqueio(bloqueiosSeguidos: number): number {
  return Math.min(BLOQUEIO_INICIAL_MIN * 2 ** Math.max(0, bloqueiosSeguidos - 1), BLOQUEIO_MAXIMO_MIN);
}

export function credenciaisInvalidas(): HttpsError {
  return new HttpsError("permission-denied", "PIN incorreto.", { motivo: "credenciais-invalidas" });
}

/**
 * Dois funcionários com o mesmo PIN antigo (de antes de o PIN ser único na
 * empresa): não dá para saber quem é. O gestor vê o alerta e troca o PIN deles.
 */
function erroPinRepetido(): HttpsError {
  return new HttpsError("failed-precondition", "Este PIN é igual ao de outro funcionário. Peça ao gestor um PIN novo.", {
    motivo: "pin-repetido",
  });
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
    "Este aparelho está com a versão antiga do ponto, que pedia a matrícula. Recarregue a página: agora é só o PIN.",
    { motivo: "versao-antiga" },
  );
}

/**
 * PIN de 4 números, do teclado do aparelho. Formato errado conta como PIN
 * incorreto. O CPF que a tela de 09 a 13/10/2026 mandava junto é ignorado: o
 * PIN sozinho diz quem é.
 */
export function lerPin(dados: Record<string, unknown>): string {
  const semCpf = dados.cpf === undefined || dados.cpf === null || dados.cpf === "";
  if (semCpf && typeof dados.matricula === "string" && dados.matricula !== "") throw erroVersaoAntiga();
  if (typeof dados.pin !== "string" || !/^\d{4}$/.test(dados.pin)) throw credenciaisInvalidas();
  return dados.pin;
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
  /** Início da janela de erros do aparelho em que esta tentativa foi contada. */
  janelaAparelho: number;
  /** Minutos de bloqueio que esta tentativa aplica ao PIN do funcionário, se errar. */
  bloqueioPinMin: number | null;
  /** Esta tentativa, se errar, completa o limite de erros do aparelho. */
  bloqueiaAparelho: boolean;
}

/**
 * Conta a tentativa como erro ANTES de responder, numa transação. Se o PIN
 * estiver certo, confirmarAcerto desfaz a contagem. Assim o limite vale mesmo
 * para tentativas simultâneas. credenciaisRef: o dono do celular pessoal, cujo
 * PIN também tem limite de erros.
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

    return { janelaAparelho: inicio.toMillis(), bloqueioPinMin, bloqueiaAparelho: quantidade >= MAX_FALHAS_APARELHO };
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
  empresaRef: DocumentReference;
  dispositivoId: string;
  dispositivoNome: string;
  /** Dono do celular pessoal (o PIN dele bloqueia com 5 erros seguidos). */
  donoId: string | null;
  miniatura: Buffer | null;
}) {
  const { reserva, empresaRef, dispositivoId, dispositivoNome, donoId, miniatura } = params;
  const empresaId = empresaRef.id;
  const autor = { uid: dispositivoId, nome: `Aparelho "${dispositivoNome}"` };
  const foto = miniatura ? `data:image/jpeg;base64,${miniatura.toString("base64")}` : null;
  if (reserva.bloqueioPinMin && donoId) {
    const nome = String((await empresaRef.collection("funcionarios").doc(donoId).get()).get("nome") ?? "");
    await registrarAuditoria({
      empresaId,
      autor,
      acao: "pin.bloqueado",
      descricao:
        `PIN de ${nome} bloqueado por ${reserva.bloqueioPinMin} min depois de ` +
        `${MAX_FALHAS_PIN} tentativas erradas seguidas no aparelho "${dispositivoNome}".`,
      detalhes: { funcionarioId: donoId, dispositivoId, minutos: reserva.bloqueioPinMin, foto },
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

/** Alerta para o gestor: o mesmo PIN antigo é de mais de um funcionário. */
async function avisarPinRepetido(empresaRef: DocumentReference, funcionarioIds: string[], dispositivoId: string, dispositivoNome: string) {
  const funcionarios = await db.getAll(...funcionarioIds.map((id) => empresaRef.collection("funcionarios").doc(id)));
  const nomes = funcionarios.map((f) => String(f.get("nome") ?? f.id));
  await registrarAuditoria({
    empresaId: empresaRef.id,
    autor: { uid: dispositivoId, nome: `Aparelho "${dispositivoNome}"` },
    acao: "pin.repetido",
    descricao: `${nomes.join(", ")} têm o mesmo PIN, e nenhum deles consegue bater o ponto com ele. Troque o PIN de cada um em Funcionários.`,
    detalhes: { funcionarios: funcionarioIds, dispositivoId },
  });
}

/**
 * PIN antigo (chave por funcionário) acertado: passa para o índice, e a chave
 * antiga sai das credenciais. Daí em diante, o PIN é achado por uma leitura.
 */
async function passarParaOIndice(empresaRef: DocumentReference, funcionarioId: string, indice: string) {
  const pinRef = empresaRef.collection("pins").doc(indice);
  await db.runTransaction(async (tx) => {
    const atual = await tx.get(pinRef);
    // Proteção: salvarFuncionario não deixa dar a outro funcionário um PIN antigo em uso.
    if (atual.exists && atual.get("funcionarioId") !== funcionarioId) throw erroPinRepetido();
    tx.set(pinRef, { funcionarioId, criadoEm: FieldValue.serverTimestamp() });
    tx.update(empresaRef.collection("credenciais").doc(funcionarioId), { pinIndice: indice, pinChave: FieldValue.delete() });
  });
}

export interface Identificacao {
  empresa: Empresa;
  empresaRef: DocumentReference;
  dispositivoRef: DocumentReference;
  dispositivo: DocumentData;
  funcionarioId: string;
  funcionario: DocumentData;
  /** Dados do servidor sobre o funcionário (índice do PIN, erros, última marcação). */
  credenciaisRef: DocumentReference;
}

/**
 * Identificação no aparelho: aparelho ativo e PIN de um funcionário ativo. No
 * celular pessoal, o PIN tem que ser o do dono do aparelho.
 */
export async function identificarNoAparelho(params: {
  empresaId: string;
  dispositivoId: string;
  pin: string;
  /** Foto pequena da tentativa: vai para a auditoria se a tentativa causar bloqueio. */
  miniatura?: Buffer | null;
  /** Empresa já sendo carregada por quem chamou (evita ler duas vezes). */
  empresa?: Promise<Empresa>;
}): Promise<Identificacao> {
  const { empresaId, dispositivoId, pin, miniatura = null } = params;
  const empresaRef = db.doc(`empresas/${empresaId}`);
  const dispositivoRef = empresaRef.collection("dispositivos").doc(dispositivoId);
  // O dono do PIN é procurado (uma leitura, pelo índice) junto com o aparelho.
  const indice = await indiceDoPin(empresaId, pin);
  const doIndice = empresaRef.collection("pins").doc(indice).get();
  doIndice.catch(() => undefined);
  const [empresa, dispositivoSnap] = await Promise.all([params.empresa ?? carregarEmpresa(empresaId), dispositivoRef.get()]);
  const dispositivo = exigirAparelhoAtivo(dispositivoSnap.data(), empresa);
  const dispositivoNome = String(dispositivo.nome ?? "");
  // Celular pessoal: só o dono bate ponto nele.
  const donoId = typeof dispositivo.funcionarioId === "string" && dispositivo.funcionarioId !== "" ? dispositivo.funcionarioId : null;

  const reserva = await reservarTentativa(dispositivoRef, donoId ? empresaRef.collection("credenciais").doc(donoId) : null);

  const indexado: unknown = (await doIndice).get("funcionarioId");
  let funcionarioId = typeof indexado === "string" ? indexado : null;
  let pinAntigo = false;
  if (!funcionarioId) {
    // Fora do índice, só pode ser um PIN antigo (ou um PIN errado).
    const antigos = await donosDoPinAntigo((await credenciaisComPinAntigo(empresaRef).get()).docs, empresaId, pin);
    const candidatos = donoId ? antigos.filter((id) => id === donoId) : antigos;
    if (candidatos.length > 1) {
      await avisarPinRepetido(empresaRef, candidatos, dispositivoId, dispositivoNome);
      throw erroPinRepetido();
    }
    funcionarioId = candidatos[0] ?? null;
    pinAntigo = funcionarioId !== null;
  }
  if (donoId && funcionarioId !== donoId) funcionarioId = null;

  const credenciaisRef = funcionarioId ? empresaRef.collection("credenciais").doc(funcionarioId) : null;
  const [funcionarioSnap, credenciaisSnap] =
    funcionarioId && credenciaisRef
      ? await Promise.all([empresaRef.collection("funcionarios").doc(funcionarioId).get(), credenciaisRef.get()])
      : [null, null];
  const funcionario = funcionarioSnap?.get("ativo") === true ? funcionarioSnap.data() : undefined;
  // O índice e as credenciais são gravados juntos: conferir os dois protege de um índice desatualizado.
  const acertou = funcionario !== undefined && (pinAntigo || mesmaChave(credenciaisSnap?.get("pinIndice"), indice));

  if (!acertou || !funcionario || !funcionarioId || !credenciaisRef) {
    // O PIN nunca vai para o log.
    logger.warn("PIN incorreto no aparelho", { empresaId, dispositivoId, donoId });
    await auditarBloqueios({ reserva, empresaRef, dispositivoId, dispositivoNome, donoId, miniatura });
    throw credenciaisInvalidas();
  }

  if (pinAntigo) await passarParaOIndice(empresaRef, funcionarioId, indice);
  await confirmarAcerto(dispositivoRef, credenciaisRef, reserva.janelaAparelho);
  return { empresa, empresaRef, dispositivoRef, dispositivo, funcionarioId, funcionario, credenciaisRef };
}

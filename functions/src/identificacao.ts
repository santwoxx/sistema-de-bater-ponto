import { Timestamp, type DocumentData, type DocumentReference } from "firebase-admin/firestore";
import { HttpsError } from "firebase-functions/https";
import * as logger from "firebase-functions/logger";
import { db } from "./admin";
import { carregarEmpresa, type Empresa } from "./acesso";
import { verificarPin } from "./seguranca";
import { normalizarMatricula } from "./validacao";

// Identificação do funcionário no aparelho de ponto (matrícula + PIN), usada
// tanto para bater o ponto quanto para solicitar uma marcação esquecida.
//
// Proteção contra adivinhação de PIN:
//  - por funcionário: 5 erros seguidos bloqueiam a matrícula por 15 minutos;
//  - por aparelho: 25 erros em 15 minutos bloqueiam o aparelho até a janela passar.
const MAX_FALHAS_PIN = 5;
const BLOQUEIO_PIN_MS = 15 * 60_000;
const MAX_FALHAS_APARELHO = 25;
const JANELA_FALHAS_APARELHO_MS = 15 * 60_000;

export const MAX_MINIATURA_BYTES = 16 * 1024;

export function credenciaisInvalidas(): HttpsError {
  return new HttpsError("permission-denied", "Matrícula ou PIN inválidos.");
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

async function registrarFalhaPin(credenciaisRef: DocumentReference): Promise<void> {
  await db.runTransaction(async (tx) => {
    const falhas = ((await tx.get(credenciaisRef)).get("falhas") ?? 0) + 1;
    if (falhas >= MAX_FALHAS_PIN) {
      tx.update(credenciaisRef, { falhas: 0, bloqueadoAte: Timestamp.fromMillis(Date.now() + BLOQUEIO_PIN_MS) });
    } else {
      tx.update(credenciaisRef, { falhas });
    }
  });
}

export async function registrarFalhaAparelho(dispositivoRef: DocumentReference): Promise<void> {
  await db.runTransaction(async (tx) => {
    const atual = (await tx.get(dispositivoRef)).get("falhas") as { inicio: Timestamp; quantidade: number } | undefined;
    const agora = Date.now();
    if (!atual || agora - atual.inicio.toMillis() > JANELA_FALHAS_APARELHO_MS) {
      tx.update(dispositivoRef, { falhas: { inicio: Timestamp.fromMillis(agora), quantidade: 1 } });
    } else {
      tx.update(dispositivoRef, { "falhas.quantidade": atual.quantidade + 1 });
    }
  });
}

function aparelhoBloqueado(dispositivo: DocumentData): boolean {
  const falhas = dispositivo.falhas as { inicio: Timestamp; quantidade: number } | undefined;
  return Boolean(
    falhas && Date.now() - falhas.inicio.toMillis() <= JANELA_FALHAS_APARELHO_MS && falhas.quantidade >= MAX_FALHAS_APARELHO,
  );
}

/** Confere se o aparelho e a empresa podem receber registros agora. */
export function exigirAparelhoAtivo(dispositivo: DocumentData | undefined, empresa: Empresa): DocumentData {
  if (!dispositivo || dispositivo.ativo !== true) {
    throw new HttpsError("permission-denied", "Este aparelho foi desativado. Peça ao gestor para ativá-lo novamente.");
  }
  if (!empresa.ativo) throw new HttpsError("failed-precondition", "Empresa desativada. Procure o gestor.");
  if (aparelhoBloqueado(dispositivo)) {
    throw new HttpsError("resource-exhausted", "Muitas tentativas inválidas neste aparelho. Aguarde alguns minutos.");
  }
  return dispositivo;
}

/** Valida o PIN contra o hash guardado, aplicando os bloqueios por erro. */
export async function conferirPin(params: {
  pin: string;
  credenciaisRef: DocumentReference;
  credenciais: DocumentData | undefined;
  dispositivoRef: DocumentReference;
  contexto: Record<string, string>;
}): Promise<void> {
  const { pin, credenciaisRef, credenciais, dispositivoRef, contexto } = params;
  if (!credenciais?.pinHash) throw new HttpsError("failed-precondition", "PIN ainda não cadastrado. Procure o gestor.");
  const bloqueadoAte = (credenciais.bloqueadoAte as Timestamp | null)?.toMillis() ?? 0;
  if (bloqueadoAte > Date.now()) {
    const minutos = Math.ceil((bloqueadoAte - Date.now()) / 60_000);
    throw new HttpsError(
      "resource-exhausted",
      `Muitas tentativas incorretas. Tente novamente em ${minutos} min ou peça ao gestor para redefinir seu PIN.`,
    );
  }
  if (!(await verificarPin(pin, credenciais.pinHash, credenciais.pinSal))) {
    await Promise.all([registrarFalhaPin(credenciaisRef), registrarFalhaAparelho(dispositivoRef)]);
    logger.warn("PIN incorreto", contexto);
    throw credenciaisInvalidas();
  }
}

/**
 * Identificação completa no aparelho: aparelho ativo, funcionário ativo com
 * a matrícula informada e PIN correto. Usada pela solicitação de marcação.
 */
export async function identificarNoAparelho(params: {
  empresaId: string;
  dispositivoId: string;
  matricula: string;
  pin: string;
}) {
  const { empresaId, dispositivoId, matricula, pin } = params;
  const empresaRef = db.doc(`empresas/${empresaId}`);
  const dispositivoRef = empresaRef.collection("dispositivos").doc(dispositivoId);
  const [empresa, dispositivoSnap, funcionarios] = await Promise.all([
    carregarEmpresa(empresaId),
    dispositivoRef.get(),
    empresaRef.collection("funcionarios").where("matricula", "==", matricula).limit(1).get(),
  ]);
  const dispositivo = exigirAparelhoAtivo(dispositivoSnap.data(), empresa);

  const funcionarioDoc = funcionarios.docs[0];
  const funcionario = funcionarioDoc?.data();
  if (!funcionarioDoc || !funcionario || funcionario.ativo !== true) {
    await registrarFalhaAparelho(dispositivoRef);
    throw credenciaisInvalidas();
  }

  const credenciaisRef = empresaRef.collection("credenciais").doc(funcionarioDoc.id);
  await conferirPin({
    pin,
    credenciaisRef,
    credenciais: (await credenciaisRef.get()).data(),
    dispositivoRef,
    contexto: { empresaId, funcionarioId: funcionarioDoc.id, dispositivoId },
  });

  return { empresa, empresaRef, dispositivo, funcionarioId: funcionarioDoc.id, funcionario };
}

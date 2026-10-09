import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { FieldValue } from "firebase-admin/firestore";
import { db } from "./admin";

// PIN do ponto: 4 números definidos pelo gestor. No aparelho da loja, o
// funcionário digita o CPF e o PIN; no celular pessoal, só o PIN (o aparelho
// já é dele).
//
// O PIN não é gravado. Guardamos só a chave HMAC(segredo do servidor,
// empresa|funcionário|PIN), num documento que nenhum navegador lê; o segredo
// fica em sistema/pin, também inacessível (ver firestore.rules). Quem copiar o
// banco sem o segredo não consegue testar os 10 mil PINs possíveis.

let segredo: Promise<Buffer> | null = null;

function obterSegredo(): Promise<Buffer> {
  segredo ??= carregarOuCriarSegredo().catch((erro: unknown) => {
    segredo = null;
    throw erro;
  });
  return segredo;
}

async function carregarOuCriarSegredo(): Promise<Buffer> {
  const ref = db.doc("sistema/pin");
  let snap = await ref.get();
  if (!snap.exists) {
    try {
      await ref.create({ segredo: randomBytes(32).toString("base64"), criadoEm: FieldValue.serverTimestamp() });
    } catch (erro) {
      // Outra cópia da função criou ao mesmo tempo (ALREADY_EXISTS): vale a que foi gravada.
      if ((erro as { code?: number }).code !== 6) throw erro;
    }
    snap = await ref.get();
  }
  return Buffer.from(String(snap.get("segredo")), "base64");
}

/** Chave do PIN de um funcionário (o que fica gravado no lugar do PIN). */
export async function chaveDoPin(empresaId: string, funcionarioId: string, pin: string): Promise<string> {
  return createHmac("sha256", await obterSegredo()).update(`${empresaId}|${funcionarioId}|${pin}`).digest("hex");
}

/** Confere o PIN digitado com a chave gravada, em tempo constante. */
export async function pinConfere(chaveGravada: unknown, empresaId: string, funcionarioId: string, pin: string): Promise<boolean> {
  const calculada = Buffer.from(await chaveDoPin(empresaId, funcionarioId, pin), "hex");
  const gravada = Buffer.from(typeof chaveGravada === "string" ? chaveGravada : "", "hex");
  return gravada.length === calculada.length && timingSafeEqual(gravada, calculada);
}

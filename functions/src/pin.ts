import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { FieldValue, type DocumentReference, type Query, type QueryDocumentSnapshot } from "firebase-admin/firestore";
import { db } from "./admin";

// PIN do ponto: 4 números definidos pelo gestor, um diferente para cada
// funcionário da empresa. No aparelho, o funcionário digita só o PIN: é ele que
// diz quem está batendo o ponto.
//
// O PIN não é gravado. Guardamos só o índice HMAC(segredo do servidor,
// empresa|PIN): nas credenciais do funcionário e como id de
// empresas/{empresa}/pins/{índice}, que aponta o dono do PIN (uma leitura acha
// quem é, e o mesmo PIN não vai para dois funcionários). Nenhum navegador lê
// esses documentos; o segredo fica em sistema/pin, também inacessível (ver
// firestore.rules). Quem copiar o banco sem o segredo não consegue testar os
// 10 mil PINs possíveis.
//
// PINs definidos até 13/10/2026 têm a chave antiga, por funcionário
// (HMAC de empresa|funcionário|PIN, campo pinChave): continuam valendo e passam
// para o índice na primeira batida (ver identificacao.ts).

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

/** Índice do PIN na empresa (o que fica gravado no lugar do PIN). */
export async function indiceDoPin(empresaId: string, pin: string): Promise<string> {
  return createHmac("sha256", await obterSegredo()).update(`pin|${empresaId}|${pin}`).digest("hex");
}

/** Compara um índice ou chave gravado com o calculado, em tempo constante. */
export function mesmaChave(gravada: unknown, calculada: string): boolean {
  const a = Buffer.from(typeof gravada === "string" ? gravada : "", "hex");
  const b = Buffer.from(calculada, "hex");
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Confere o PIN digitado com a chave antiga de um funcionário (PINs definidos até 13/10/2026). */
export async function pinAntigoConfere(chaveGravada: unknown, empresaId: string, funcionarioId: string, pin: string): Promise<boolean> {
  const chave = createHmac("sha256", await obterSegredo()).update(`${empresaId}|${funcionarioId}|${pin}`).digest("hex");
  return mesmaChave(chaveGravada, chave);
}

/** Credenciais da empresa que ainda têm a chave antiga (sem índice). */
export function credenciaisComPinAntigo(empresaRef: DocumentReference): Query {
  return empresaRef.collection("credenciais").where("pinChave", ">", "");
}

/** Dos funcionários com PIN antigo, os que têm este PIN. */
export async function donosDoPinAntigo(antigos: QueryDocumentSnapshot[], empresaId: string, pin: string): Promise<string[]> {
  const confere = await Promise.all(antigos.map((doc) => pinAntigoConfere(doc.get("pinChave"), empresaId, doc.id, pin)));
  return antigos.filter((_, i) => confere[i]).map((doc) => doc.id);
}

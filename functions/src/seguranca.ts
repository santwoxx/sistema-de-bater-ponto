import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

// Funções de segurança usadas em vários pontos (o PIN do ponto fica em pin.ts).

export function sha256(dados: string | Buffer): string {
  return createHash("sha256").update(dados).digest("hex");
}

/** Compara dois segredos em tempo constante (o tempo não revela quantos caracteres batem). */
export function segredosIguais(a: string, b: string): boolean {
  return timingSafeEqual(createHash("sha256").update(a).digest(), createHash("sha256").update(b).digest());
}

export function senhaAleatoria(): string {
  return randomBytes(24).toString("base64url");
}

const ALFABETO_ID = "abcdefghijklmnopqrstuvwxyz0123456789";
// Maior múltiplo de 36 que cabe num byte: bytes acima dele são descartados para
// que todos os caracteres tenham a mesma chance (sem viés do resto da divisão).
const LIMITE_BYTE_ID = 256 - (256 % ALFABETO_ID.length);

export function idAleatorio(tamanho = 20): string {
  let id = "";
  while (id.length < tamanho) {
    for (const byte of randomBytes(tamanho)) {
      if (byte < LIMITE_BYTE_ID && id.length < tamanho) id += ALFABETO_ID[byte % ALFABETO_ID.length];
    }
  }
  return id;
}

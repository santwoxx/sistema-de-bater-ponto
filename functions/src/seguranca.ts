import { createHash, randomBytes, scrypt, timingSafeEqual } from "node:crypto";

// O PIN nunca é gravado em texto puro: guardamos apenas um hash scrypt com
// sal aleatório, numa coleção que nenhum navegador consegue ler.

function derivar(pin: string, sal: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(pin, sal, 32, { N: 16384, r: 8, p: 1 }, (erro, chave) => (erro ? reject(erro) : resolve(chave)));
  });
}

export async function gerarHashPin(pin: string): Promise<{ pinHash: string; pinSal: string }> {
  const sal = randomBytes(16);
  const hash = await derivar(pin, sal);
  return { pinHash: hash.toString("base64"), pinSal: sal.toString("base64") };
}

export async function verificarPin(pin: string, pinHash: string, pinSal: string): Promise<boolean> {
  const esperado = Buffer.from(pinHash, "base64");
  const obtido = await derivar(pin, Buffer.from(pinSal, "base64"));
  return esperado.length === obtido.length && timingSafeEqual(esperado, obtido);
}

const SAL_FICTICIO = randomBytes(16);

/**
 * Gasta o mesmo tempo de uma conferência de PIN de verdade. Usada quando a
 * matrícula não existe: assim o tempo de resposta não revela quais existem.
 */
export async function simularConferenciaPin(pin: string): Promise<void> {
  await derivar(pin, SAL_FICTICIO);
}

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

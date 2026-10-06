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

export function sha256(dados: string | Buffer): string {
  return createHash("sha256").update(dados).digest("hex");
}

export function senhaAleatoria(): string {
  return randomBytes(24).toString("base64url");
}

export function idAleatorio(tamanho = 20): string {
  const alfabeto = "abcdefghijklmnopqrstuvwxyz0123456789";
  const bytes = randomBytes(tamanho);
  let id = "";
  for (const byte of bytes) id += alfabeto[byte % alfabeto.length];
  return id;
}

import { generateKeyPairSync, randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { abrirPacote, ancoraValida, avaliarHorario, criarAncora, MAX_HORAS_SEM_INTERNET } from "./semInternet";

const MIN = 60_000;
const ANCORA = Date.UTC(2026, 9, 8, 11, 0, 0);

// Batida feita "minutos" depois da âncora, pelo relógio contínuo; o relógio do
// aparelho pode estar adiantado ou atrasado (desvio) e chegar ao servidor depois.
function horario({ minutos, desvio = 0, reiniciado = false, chegada = minutos + 30 }: { minutos: number; desvio?: number; reiniciado?: boolean; chegada?: number }) {
  // O relógio do aparelho estava 7 min errado desde antes: só a diferença (desvio) importa.
  const relogioNaAncora = ANCORA - 7 * MIN;
  return avaliarHorario({
    ancoraEm: ANCORA,
    relogioNaAncora,
    relogioAgora: relogioNaAncora + (minutos + desvio) * MIN,
    decorrido: reiniciado ? null : minutos * MIN,
    recebidoEm: ANCORA + chegada * MIN,
  });
}

describe("horário da batida sem internet", () => {
  it("relógio e tempo decorrido batem: horário confiável, sem conferência", () => {
    expect(horario({ minutos: 90 })).toMatchObject({ aceito: true, horario: ANCORA + 90 * MIN, conferir: false, motivo: null });
    // Relógio errado desde antes da queda não importa: o horário vem da âncora.
    expect(horario({ minutos: 90, desvio: 1 })).toMatchObject({ aceito: true, conferir: false });
  });

  it("relógio atrasado de propósito (para fingir chegada mais cedo): vale o tempo decorrido e marca para conferir", () => {
    const r = horario({ minutos: 120, desvio: -30 });
    expect(r).toMatchObject({ aceito: true, horario: ANCORA + 120 * MIN, conferir: true });
    expect(r.aceito && r.motivo).toMatch(/relógio do aparelho foi mudado/);
  });

  it("relógio à frente do tempo decorrido (repouso ou relógio adiantado): vale o relógio e marca para conferir", () => {
    const r = horario({ minutos: 60, desvio: 45, chegada: 200 });
    expect(r).toMatchObject({ aceito: true, horario: ANCORA + 105 * MIN, conferir: true });
    // Relógio no futuro em relação à chegada: não serve, vale o tempo decorrido.
    expect(horario({ minutos: 60, desvio: 300, chegada: 100 })).toMatchObject({ aceito: true, horario: ANCORA + 60 * MIN, conferir: true });
  });

  it("aparelho reiniciado sem internet: só o relógio, sempre para conferir", () => {
    const r = horario({ minutos: 50, reiniciado: true });
    expect(r).toMatchObject({ aceito: true, horario: ANCORA + 50 * MIN, conferir: true });
    expect(r.aceito && r.motivo).toMatch(/reiniciado/);
  });

  it("recusa horário antes da última conexão, no futuro ou antigo demais", () => {
    expect(horario({ minutos: 10, desvio: -60, reiniciado: true })).toMatchObject({ aceito: false, motivo: expect.stringMatching(/anterior à última conexão/) });
    expect(horario({ minutos: 30, desvio: 120, reiniciado: true, chegada: 40 })).toMatchObject({ aceito: false, motivo: expect.stringMatching(/futuro/) });
    const antiga = horario({ minutos: 60, chegada: 60 + MAX_HORAS_SEM_INTERNET * 60 + 5 });
    expect(antiga).toMatchObject({ aceito: false, motivo: expect.stringMatching(/mais de 72 horas/) });
  });
});

describe("âncora de horário", () => {
  const segredo = randomBytes(32);

  it("só vale para o aparelho e o horário assinados pelo servidor", () => {
    const ancora = criarAncora(segredo, "disp_a", ANCORA);
    expect(ancoraValida(segredo, "disp_a", ancora)).toBe(true);
    expect(ancoraValida(segredo, "disp_b", ancora)).toBe(false);
    expect(ancoraValida(segredo, "disp_a", { ...ancora, em: ANCORA - 3_600_000 })).toBe(false);
    expect(ancoraValida(randomBytes(32), "disp_a", ancora)).toBe(false);
    expect(ancoraValida(segredo, "disp_a", null)).toBe(false);
    expect(ancoraValida(segredo, "disp_a", { em: "x", assinatura: ancora.assinatura })).toBe(false);
  });
});

describe("pacote cifrado no aparelho", () => {
  const { publicKey, privateKey } = generateKeyPairSync("rsa", {
    modulusLength: 3072,
    publicKeyEncoding: { type: "spki", format: "der" },
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
  });

  // Mesma cifragem do navegador (web/src/paginas/ponto/terminal/semInternet.ts), com Web Crypto.
  async function selar(conteudo: unknown) {
    const subtle = globalThis.crypto.subtle;
    const publica = await subtle.importKey("spki", publicKey, { name: "RSA-OAEP", hash: "SHA-256" }, false, ["encrypt"]);
    const aes = await subtle.generateKey({ name: "AES-GCM", length: 256 }, true, ["encrypt"]);
    const iv = globalThis.crypto.getRandomValues(new Uint8Array(12));
    const dados = await subtle.encrypt({ name: "AES-GCM", iv }, aes, new TextEncoder().encode(JSON.stringify(conteudo)));
    const chave = await subtle.encrypt({ name: "RSA-OAEP" }, publica, await subtle.exportKey("raw", aes));
    const b64 = (b: ArrayBuffer | Uint8Array) => Buffer.from(b instanceof Uint8Array ? b : new Uint8Array(b)).toString("base64");
    return { versao: 1, chave: b64(chave), iv: b64(iv), dados: b64(dados) };
  }

  it("o servidor abre o que o navegador cifrou com a chave pública", async () => {
    const conteudo = { matricula: "12", pin: "3691", foto: "data:image/jpeg;base64,/9j/AAAA" };
    expect(abrirPacote(privateKey, await selar(conteudo))).toEqual(conteudo);
  });

  it("pacote alterado, de outra chave ou em formato estranho é recusado", async () => {
    const pacote = await selar({ pin: "3691" });
    const dados = Buffer.from(pacote.dados, "base64");
    dados[0] ^= 1;
    expect(() => abrirPacote(privateKey, { ...pacote, dados: dados.toString("base64") })).toThrow();
    const outra = generateKeyPairSync("rsa", { modulusLength: 2048, privateKeyEncoding: { type: "pkcs8", format: "pem" }, publicKeyEncoding: { type: "spki", format: "pem" } });
    expect(() => abrirPacote(outra.privateKey, pacote)).toThrow();
    expect(() => abrirPacote(privateKey, { ...pacote, versao: 2 })).toThrow();
    expect(() => abrirPacote(privateKey, null)).toThrow();
  });
});

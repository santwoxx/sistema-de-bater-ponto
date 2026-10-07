import { describe, expect, it } from "vitest";
import { gerarHashPin, idAleatorio, segredosIguais, verificarPin } from "./seguranca";

describe("segurança", () => {
  it("gera ids aleatórios só com letras minúsculas e números, do tamanho pedido", () => {
    const ids = new Set(Array.from({ length: 2000 }, () => idAleatorio(20)));
    expect(ids.size).toBe(2000);
    for (const id of ids) expect(id).toMatch(/^[a-z0-9]{20}$/);
    expect(idAleatorio(7)).toHaveLength(7);
  });

  it("compara segredos sem depender do tamanho", () => {
    expect(segredosIguais("ABCD-1234", "ABCD-1234")).toBe(true);
    expect(segredosIguais("ABCD-1234", "ABCD-1235")).toBe(false);
    expect(segredosIguais("", "ABCD-1234")).toBe(false);
  });

  it("confere o PIN pelo hash com sal, nunca pelo texto", async () => {
    const { pinHash, pinSal } = await gerarHashPin("2580");
    expect(pinHash).not.toContain("2580");
    expect(await verificarPin("2580", pinHash, pinSal)).toBe(true);
    expect(await verificarPin("2581", pinHash, pinSal)).toBe(false);
    const outro = await gerarHashPin("2580");
    expect(outro.pinHash).not.toBe(pinHash);
  });
});

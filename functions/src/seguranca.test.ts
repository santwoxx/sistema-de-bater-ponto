import { describe, expect, it } from "vitest";
import { idAleatorio, segredosIguais } from "./seguranca";

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
});

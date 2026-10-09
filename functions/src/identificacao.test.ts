import { describe, expect, it } from "vitest";
import { lerCpfPin, minutosDeBloqueio } from "./identificacao";

describe("CPF e PIN digitados no aparelho", () => {
  it("aceita CPF válido (só números) e PIN de 4 números; no celular pessoal, só o PIN", () => {
    expect(lerCpfPin({ cpf: "52998224725", pin: "2580" })).toEqual({ cpf: "52998224725", pin: "2580" });
    expect(lerCpfPin({ pin: "0007" })).toEqual({ cpf: null, pin: "0007" });
  });

  it("formato errado conta como CPF ou PIN incorretos (mesma resposta de um PIN errado)", () => {
    for (const dados of [
      { cpf: "52998224725", pin: "258" },
      { cpf: "52998224725", pin: "25801" },
      { cpf: "52998224726", pin: "2580" },
      { cpf: "529.982.247-25", pin: "2580" },
      { cpf: "5299822472", pin: "2580" },
      { cpf: 52998224725, pin: "2580" },
    ]) {
      expect(() => lerCpfPin(dados)).toThrow("CPF ou PIN incorretos.");
    }
  });

  it("bloqueios seguidos do mesmo PIN dobram de tempo, até 1 hora", () => {
    expect([1, 2, 3, 4].map(minutosDeBloqueio)).toEqual([15, 30, 60, 60]);
  });
});

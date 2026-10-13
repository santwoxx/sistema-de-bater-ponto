import { describe, expect, it } from "vitest";
import { lerPin, minutosDeBloqueio } from "./identificacao";

describe("PIN digitado no aparelho", () => {
  it("aceita só o PIN de 4 números", () => {
    expect(lerPin({ pin: "2580" })).toBe("2580");
    expect(lerPin({ pin: "0007" })).toBe("0007");
  });

  it("formato errado conta como PIN incorreto (mesma resposta de um PIN errado)", () => {
    for (const dados of [{ pin: "258" }, { pin: "25801" }, { pin: "25a0" }, { pin: 2580 }, {}]) {
      expect(() => lerPin(dados)).toThrow("PIN incorreto.");
    }
  });

  it("tela de 09 a 13/10/2026 (CPF + PIN): o CPF que vier junto é ignorado", () => {
    expect(lerPin({ cpf: "52998224725", pin: "2580" })).toBe("2580");
    expect(lerPin({ matricula: "1", cpf: "52998224725", pin: "2580" })).toBe("2580");
  });

  it("tela antiga (matrícula, sem CPF): pede para recarregar, em vez de dar erro de matrícula", () => {
    for (const dados of [{ matricula: "1", pin: "2580" }, { matricula: "12", pin: "369147" }, { matricula: "1", cpf: "", pin: "2580" }]) {
      expect(() => lerPin(dados)).toThrow(/versão antiga do ponto.*Recarregue a página: agora é só o PIN/);
    }
  });

  it("bloqueios seguidos do mesmo PIN dobram de tempo, até 1 hora", () => {
    expect([1, 2, 3, 4].map(minutosDeBloqueio)).toEqual([15, 30, 60, 60]);
  });
});

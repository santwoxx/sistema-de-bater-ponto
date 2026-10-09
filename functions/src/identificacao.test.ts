import { describe, expect, it } from "vitest";
import { matriculaParaLog } from "./identificacao";

describe("matrícula digitada no log", () => {
  it("mostra a matrícula curta inteira, para o suporte conferir o que foi digitado", () => {
    expect(matriculaParaLog("1")).toBe("1");
    expect(matriculaParaLog("004512")).toBe("004512");
  });

  it("não grava um CPF ou telefone inteiro digitado no lugar da matrícula", () => {
    expect(matriculaParaLog("52998224725")).toBe("52… (11 dígitos)");
    expect(matriculaParaLog("1199887766")).toBe("11… (10 dígitos)");
  });
});

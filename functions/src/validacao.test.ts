import { describe, expect, it } from "vitest";
import { cnpjOpcional, cnpjValido, cpf, cpfValido, matricula, normalizarMatricula, pin, pinTrivial } from "./validacao";

describe("CPF", () => {
  it("aceita CPF válido com ou sem máscara", () => {
    expect(cpfValido("52998224725")).toBe(true);
    expect(cpf("529.982.247-25")).toBe("52998224725");
  });

  it("rejeita dígito verificador errado e sequências repetidas", () => {
    expect(cpfValido("52998224726")).toBe(false);
    expect(cpfValido("11111111111")).toBe(false);
    expect(() => cpf("123")).toThrow();
  });
});

describe("CNPJ", () => {
  it("aceita CNPJ numérico", () => {
    expect(cnpjValido("11222333000181")).toBe(true);
    expect(cnpjOpcional("11.222.333/0001-81")).toBe("11222333000181");
  });

  it("aceita CNPJ alfanumérico (exemplo oficial da Receita)", () => {
    expect(cnpjValido("12ABC34501DE35")).toBe(true);
    expect(cnpjOpcional("12.abc.345/01de-35")).toBe("12ABC34501DE35");
  });

  it("rejeita CNPJ inválido e aceita vazio como opcional", () => {
    expect(cnpjValido("11222333000182")).toBe(false);
    expect(cnpjValido("12ABC34501DE36")).toBe(false);
    expect(() => cnpjOpcional("11.222.333/0001-00")).toThrow();
    expect(cnpjOpcional("")).toBe("");
    expect(cnpjOpcional(undefined)).toBe("");
  });
});

describe("PIN", () => {
  it("identifica PINs fáceis de adivinhar", () => {
    for (const fraco of ["0000", "1111", "1234", "4321", "7890", "123456", "987654"]) {
      expect(pinTrivial(fraco), fraco).toBe(true);
    }
    for (const bom of ["1357", "2580", "9137", "402816"]) {
      expect(pinTrivial(bom), bom).toBe(false);
    }
  });

  it("exige de 4 a 6 dígitos", () => {
    expect(pin("2580")).toBe("2580");
    expect(() => pin("258")).toThrow();
    expect(() => pin("2580135")).toThrow();
    expect(() => pin("25a0")).toThrow();
    expect(() => pin("1234")).toThrow();
  });
});

describe("Matrícula", () => {
  it("ignora zeros à esquerda", () => {
    expect(normalizarMatricula("0012")).toBe("12");
    expect(normalizarMatricula("000")).toBe("0");
    expect(normalizarMatricula("10")).toBe("10");
    expect(matricula(" 0042 ")).toBe("42");
  });

  it("aceita apenas números", () => {
    expect(() => matricula("A12")).toThrow();
    expect(() => matricula("12345678901")).toThrow();
  });
});

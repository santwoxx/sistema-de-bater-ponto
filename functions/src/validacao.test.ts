import { describe, expect, it } from "vitest";
import { cnpjOpcional, cnpjValido, cpf, cpfValido, matricula, normalizarMatricula, pin, pinTrivial, senha, texto } from "./validacao";

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

describe("Texto livre", () => {
  it("remove caracteres invisíveis que disfarçam o texto", () => {
    // U+202E inverte a direção do texto na tela; U+200B é um espaço de largura zero.
    expect(texto("Maria‮ anuoS", "Nome")).toBe("Maria anuoS");
    expect(texto("Jo​ão", "Nome")).toBe("João");
  });

  it("troca caracteres de controle por espaço e junta espaços repetidos", () => {
    expect(texto("Esqueci\u0000de\nregistrar\t  hoje", "Motivo")).toBe("Esqueci de registrar hoje");
  });

  it("normaliza acentos para a mesma forma", () => {
    expect(texto("João", "Nome")).toBe("João");
  });

  it("recusa texto gigante antes de processar", () => {
    expect(() => texto("a".repeat(10_000), "Nome", { max: 120 })).toThrow(/máximo/);
  });
});

describe("Senha de administrador e gestor", () => {
  it("aceita senhas longas e pouco previsíveis", () => {
    expect(senha("cafe-com-pao-2026")).toBe("cafe-com-pao-2026");
    expect(senha("Loja Centro tem 3 caixas", "ana@loja.com")).toBe("Loja Centro tem 3 caixas");
  });

  it("recusa senhas curtas, comuns, repetidas ou em sequência", () => {
    for (const fraca of ["curta1", "12345678", "Senha123", "PASSWORD", "aaaaaaaa", "abcdefgh", "23456789"]) {
      expect(() => senha(fraca), fraca).toThrow(/Senha/);
    }
  });

  it("recusa senha que contém o próprio e-mail", () => {
    expect(() => senha("gisele2026!", "gisele@loja.com")).toThrow(/e-mail/);
    expect(senha("gisele2026!", "ana@loja.com")).toBe("gisele2026!");
  });
});

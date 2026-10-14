import { describe, expect, it } from "vitest";
import { crc16, dataHoraRep, deslocamento, fixo, hashDaMarcacaoRep, inicioDoRegistro7, latin1, numero } from "./portaria671";

const SP = "America/Sao_Paulo";

describe("formatos da Portaria 671 (AFD e AEJ)", () => {
  it("CRC-16/KERMIT: valor de conferência do padrão", () => {
    expect(crc16("123456789")).toBe("2189");
    expect(crc16("")).toBe("0000");
  });

  it("data e hora com fuso, segundos sempre 00 (exemplo da própria portaria)", () => {
    expect(dataHoraRep(new Date("2021-04-27T19:44:31Z"), SP)).toBe("2021-04-27T16:44:00-0300");
    expect(deslocamento(new Date("2026-10-14T12:00:00Z"), SP)).toBe("-0300");
    expect(deslocamento(new Date("2026-10-14T12:00:00Z"), "America/Manaus")).toBe("-0400");
    expect(deslocamento(new Date("2026-10-14T12:00:00Z"), "America/Noronha")).toBe("-0200");
    expect(deslocamento(new Date("2026-10-14T12:00:00Z"), "UTC")).toBe("+0000");
  });

  it("campos de largura fixa: da esquerda, com espaços; números com zeros", () => {
    expect(fixo("ABC", 5)).toBe("ABC  ");
    expect(fixo("ABCDEFG", 5)).toBe("ABCDE");
    expect(numero(42, 9)).toBe("000000042");
    // ISO-8859-1: acentos ficam; o que não existe na tabela vira "?".
    expect(latin1("João · Ação\n€")).toBe("João · Ação ?");
  });

  it("registro do tipo 7: 73 posições antes do hash, CPF à esquerda em 12 posições", () => {
    const marcacao = {
      nsr: 7,
      dataHora: new Date("2026-10-14T11:02:45Z"),
      cpf: "52998224725",
      gravadoEm: new Date("2026-10-14T11:02:46Z"),
      offline: false,
    };
    const inicio = inicioDoRegistro7(marcacao, SP);
    expect(inicio).toBe("0000000077" + "2026-10-14T08:02:00-0300" + "52998224725 " + "2026-10-14T08:02:00-0300" + "02" + "0");
    expect(inicio).toHaveLength(73);
    const primeiro = hashDaMarcacaoRep(marcacao, SP, "");
    expect(primeiro).toMatch(/^[0-9a-f]{64}$/);
    // Encadeado: o hash da anterior entra no cálculo.
    expect(hashDaMarcacaoRep(marcacao, SP, primeiro)).not.toBe(primeiro);
    expect(hashDaMarcacaoRep({ ...marcacao, offline: true }, SP, "")).not.toBe(primeiro);
  });
});

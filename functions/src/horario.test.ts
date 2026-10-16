import { describe, expect, it } from "vitest";
import { horarioSugerido, jornadaDoHorario, mesmoHorario, normalizarHorario, paresDoDia, problemaNoHorario, textoDoHorario } from "./horario";

const COMERCIAL = ["", "08:00-12:00 13:00-17:00", "08:00-12:00 13:00-17:00", "08:00-12:00 13:00-17:00", "08:00-12:00 13:00-17:00", "08:00-12:00 13:00-17:00", "08:00-12:00"];

describe("horário contratual", () => {
  it("lê os pares do dia; vazio é folga; formato errado é null", () => {
    expect(paresDoDia("08:00-12:00  13:00-17:00")).toEqual([
      { entrada: "08:00", saida: "12:00" },
      { entrada: "13:00", saida: "17:00" },
    ]);
    expect(paresDoDia("  ")).toEqual([]);
    expect(paresDoDia("8:00-12:00")).toBeNull();
    expect(paresDoDia("08:00-24:00")).toBeNull();
    expect(paresDoDia("08:00")).toBeNull();
  });

  it("a jornada do dia é a soma dos pares, inclusive turno que passa da meia-noite", () => {
    expect(jornadaDoHorario(COMERCIAL)).toEqual([0, 480, 480, 480, 480, 480, 240]);
    expect(jornadaDoHorario(["22:00-02:00 03:00-06:00", "", "", "", "", "", ""])[0]).toBe(7 * 60);
  });

  it("aponta o problema em cada dia", () => {
    expect(problemaNoHorario(COMERCIAL)).toBeNull();
    expect(problemaNoHorario(["", "", ""])).toMatch(/7 dias/);
    expect(problemaNoHorario(["", "8h-12h", "", "", "", "", ""])).toMatch(/seg: use "HH:MM-HH:MM"/);
    expect(problemaNoHorario(["", "08:00-08:00", "", "", "", "", ""])).toMatch(/não podem ser iguais/);
    expect(problemaNoHorario(["", "01:00-02:00 03:00-04:00 05:00-06:00 07:00-08:00", "", "", "", "", ""])).toMatch(/no máximo 3/);
  });

  it("normaliza e escreve para o espelho, juntando dias iguais seguidos", () => {
    expect(normalizarHorario([" 08:00-12:00   13:00-17:00 "])).toEqual(["08:00-12:00 13:00-17:00"]);
    expect(textoDoHorario(COMERCIAL)).toBe("seg a sex 08:00-12:00 13:00-17:00 · sáb 08:00-12:00");
    expect(textoDoHorario(["", "", "", "", "", "", ""])).toBe("sem horário contratual");
  });

  it("compara horários depois de normalizados, aceitando o que vier do banco", () => {
    expect(mesmoHorario(COMERCIAL, COMERCIAL.map((dia) => ` ${dia.replace(" ", "   ")} `))).toBe(true);
    expect(mesmoHorario(COMERCIAL, [...COMERCIAL.slice(0, 6), ""])).toBe(false);
    expect(mesmoHorario(undefined, COMERCIAL)).toBe(false);
    expect(mesmoHorario(COMERCIAL.slice(0, 6), COMERCIAL.slice(0, 6))).toBe(false);
  });

  it("sugere um horário a partir da jornada de quem foi cadastrado antes", () => {
    expect(horarioSugerido([0, 480, 528, 240, 360, 0, 0])).toEqual(["", "08:00-12:00 13:00-17:00", "08:00-12:00 13:00-17:48", "08:00-12:00", "08:00-14:00", "", ""]);
  });
});

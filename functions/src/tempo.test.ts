import { describe, expect, it } from "vitest";
import { dataLocal, horaLocal, localParaUtc } from "./tempo";

describe("fuso horário", () => {
  it("converte horário de parede para UTC nos fusos do Brasil", () => {
    expect(localParaUtc("2026-10-05", "08:00", "America/Sao_Paulo").toISOString()).toBe("2026-10-05T11:00:00.000Z");
    expect(localParaUtc("2026-10-05", "08:00", "America/Manaus").toISOString()).toBe("2026-10-05T12:00:00.000Z");
    expect(localParaUtc("2026-10-05", "08:00", "America/Rio_Branco").toISOString()).toBe("2026-10-05T13:00:00.000Z");
    expect(localParaUtc("2026-10-05", "08:00", "America/Noronha").toISOString()).toBe("2026-10-05T10:00:00.000Z");
  });

  it("calcula o dia local mesmo quando em UTC já é o dia seguinte", () => {
    const instante = new Date("2026-10-06T02:30:00Z");
    expect(dataLocal(instante, "America/Sao_Paulo")).toBe("2026-10-05");
    expect(horaLocal(instante, "America/Sao_Paulo")).toBe("23:30:00");
    expect(dataLocal(instante, "UTC")).toBe("2026-10-06");
  });

  it("respeita horário de verão onde ele existe", () => {
    expect(localParaUtc("2026-01-15", "12:00", "America/New_York").toISOString()).toBe("2026-01-15T17:00:00.000Z");
    expect(localParaUtc("2026-07-15", "12:00", "America/New_York").toISOString()).toBe("2026-07-15T16:00:00.000Z");
  });

  it("ida e volta preserva data e hora", () => {
    const instante = localParaUtc("2026-12-31", "23:59", "America/Sao_Paulo");
    expect(dataLocal(instante, "America/Sao_Paulo")).toBe("2026-12-31");
    expect(horaLocal(instante, "America/Sao_Paulo")).toBe("23:59:00");
  });
});

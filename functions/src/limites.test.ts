import { describe, expect, it } from "vitest";
import { proximoUso } from "./limites";

const LIMITE = { maximo: 3, janelaMinutos: 60 };
const HORA = 60 * 60_000;

describe("limite de uso por janela", () => {
  it("o primeiro uso abre uma janela nova", () => {
    expect(proximoUso(null, 1000, LIMITE)).toEqual({ permitido: true, janela: { inicio: 1000, quantidade: 1 } });
  });

  it("conta os usos dentro da janela e recusa quando passa do máximo", () => {
    const terceiro = proximoUso({ inicio: 0, quantidade: 2 }, 10 * 60_000, LIMITE);
    expect(terceiro).toEqual({ permitido: true, janela: { inicio: 0, quantidade: 3 } });
    expect(proximoUso({ inicio: 0, quantidade: 3 }, 10 * 60_000, LIMITE)).toEqual({ permitido: false, liberaEm: HORA });
  });

  it("libera de novo quando a janela termina", () => {
    expect(proximoUso({ inicio: 0, quantidade: 3 }, HORA, LIMITE)).toEqual({ permitido: true, janela: { inicio: HORA, quantidade: 1 } });
  });
});

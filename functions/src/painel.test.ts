import type { CallableRequest } from "firebase-functions/https";
import { describe, expect, it } from "vitest";
import { painel } from "./painel";

const chamar = (data: unknown, auth?: CallableRequest["auth"]) => painel.run({ data, auth } as CallableRequest);

describe("função painel (ações rápidas do painel numa função só)", () => {
  it("recusa ação desconhecida, inclusive nomes herdados de Object", async () => {
    for (const acao of ["apagarTudo", "constructor", "toString", "__proto__", "", 1, undefined]) {
      await expect(chamar({ acao, dados: {} })).rejects.toThrow("Ação desconhecida.");
    }
  });

  it("aquecer e as ações exigem login de usuário do painel", async () => {
    await expect(chamar({ acao: "aquecer" })).rejects.toMatchObject({ code: "unauthenticated" });
    await expect(chamar({ acao: "salvarEmpresa", dados: { nome: "X" } })).rejects.toMatchObject({ code: "unauthenticated" });
  });
});

import type { Timestamp } from "firebase-admin/firestore";
import { describe, expect, it } from "vitest";
import { HASH_INICIAL, hashDoRegistro, verificarCadeia } from "./cadeia";

const EMPRESA = "empresa1";

// Monta uma cadeia válida de marcações do aparelho, como o registrarPonto grava.
function cadeia(quantidade: number) {
  const registros: Array<{ id: string; dados: Record<string, unknown> }> = [];
  let hashAnterior = HASH_INICIAL;
  for (let nsr = 1; nsr <= quantidade; nsr++) {
    const dataHora = new Date(Date.UTC(2026, 9, 5, 11 + nsr, 0, 0));
    const campos = {
      hashAnterior,
      nsr,
      empresaId: EMPRESA,
      funcionarioId: "f1",
      funcionarioCpf: "52998224725",
      dataHora,
      dataLocal: "2026-10-05",
      horaLocal: `${String(8 + nsr).padStart(2, "0")}:00:00`,
      fotoSha256: "a".repeat(64),
      dispositivoId: "disp_1",
    };
    const hash = hashDoRegistro(campos);
    registros.push({
      id: `r${nsr}`,
      dados: { ...campos, funcionarioNome: "Maria", dataHora: { toDate: () => dataHora } as unknown as Timestamp, hash },
    });
    hashAnterior = hash;
  }
  return { registros, controle: { ultimoNsr: quantidade, ultimoHash: hashAnterior } };
}

describe("cadeia de hashes das marcações", () => {
  it("aceita uma cadeia íntegra, em qualquer ordem de leitura", () => {
    const { registros, controle } = cadeia(4);
    const resultado = verificarCadeia(EMPRESA, [...registros].reverse(), controle);
    expect(resultado.problemas).toEqual([]);
    expect(resultado.ultimoNsr).toBe(4);
  });

  it("aponta marcação alterada depois do registro", () => {
    const { registros, controle } = cadeia(3);
    registros[1].dados.horaLocal = "07:00:00";
    const { problemas } = verificarCadeia(EMPRESA, registros, controle);
    expect(problemas).toHaveLength(1);
    expect(problemas[0]).toMatchObject({ nsr: 2, registroId: "r2" });
    expect(problemas[0].descricao).toMatch(/alterados/);
  });

  it("aponta marcação apagada no meio e no fim da sequência", () => {
    const { registros, controle } = cadeia(4);
    const semAMeio = registros.filter((r) => r.id !== "r2");
    const meio = verificarCadeia(EMPRESA, semAMeio, controle).problemas.map((p) => p.descricao).join(" | ");
    expect(meio).toMatch(/NSR 2 não encontrado/);
    expect(meio).toMatch(/não encadeia/);

    const fim = verificarCadeia(EMPRESA, registros.slice(0, 3), controle).problemas;
    expect(fim).toHaveLength(1);
    expect(fim[0].descricao).toMatch(/contador/);
  });

  it("aponta hash refeito para esconder uma alteração", () => {
    const { registros, controle } = cadeia(3);
    // Quem altera o registro 2 e recalcula o hash dele quebra o elo com o registro 3.
    const r2 = registros[1].dados;
    r2.horaLocal = "07:00:00";
    r2.hash = hashDoRegistro({
      hashAnterior: String(r2.hashAnterior),
      nsr: 2,
      empresaId: EMPRESA,
      funcionarioId: "f1",
      funcionarioCpf: "52998224725",
      dataHora: (r2.dataHora as Timestamp).toDate(),
      dataLocal: "2026-10-05",
      horaLocal: "07:00:00",
      fotoSha256: "a".repeat(64),
      dispositivoId: "disp_1",
    });
    const { problemas } = verificarCadeia(EMPRESA, registros, controle);
    expect(problemas.some((p) => p.nsr === 3 && /não encadeia/.test(p.descricao))).toBe(true);
  });

  it("batida sem internet: a marca entra no hash e não pode ser escondida", () => {
    const { registros, controle } = cadeia(2);
    // A 2ª marcação foi feita sem internet, antes da 1ª, e chegou depois (NSR maior, horário menor).
    const r2 = registros[1].dados;
    const dataHora = new Date(Date.UTC(2026, 9, 5, 11, 30, 0));
    const recebidoEm = new Date(Date.UTC(2026, 9, 5, 14, 0, 0));
    const semInternet = { recebidoEm, conferir: false };
    r2.dataHora = { toDate: () => dataHora } as unknown as Timestamp;
    r2.horaLocal = "08:30:00";
    r2.semInternet = { recebidoEm: { toDate: () => recebidoEm } as unknown as Timestamp, conferir: false };
    r2.hash = hashDoRegistro({ ...(r2 as unknown as Parameters<typeof hashDoRegistro>[0]), dataHora, semInternet });
    const integra = { ultimoNsr: 2, ultimoHash: String(r2.hash) };
    expect(verificarCadeia(EMPRESA, registros, integra).problemas).toEqual([]);
    expect(r2.hash).not.toBe(hashDoRegistro({ ...(r2 as unknown as Parameters<typeof hashDoRegistro>[0]), dataHora, semInternet: null }));

    // Apagar a marca "sem internet" (ou o "conferir horário") direto no banco quebra a cadeia.
    delete r2.semInternet;
    expect(verificarCadeia(EMPRESA, registros, integra).problemas[0]?.descricao).toMatch(/alterados/);
    r2.semInternet = { recebidoEm: { toDate: () => recebidoEm } as unknown as Timestamp, conferir: true };
    expect(verificarCadeia(EMPRESA, registros, integra).problemas[0]?.descricao).toMatch(/alterados/);
    expect(verificarCadeia(EMPRESA, registros, controle).problemas.length).toBeGreaterThan(0);
  });
});

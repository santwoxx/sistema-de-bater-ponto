import type { Timestamp } from "firebase-admin/firestore";
import { describe, expect, it } from "vitest";
import { HASH_INICIAL, hashDaOperacao, hashDoRegistro, verificarCadeia } from "./cadeia";
import { hashDaMarcacaoRep, type OperacaoRep } from "./portaria671";

const EMPRESA = "empresa1";
const SP = "America/Sao_Paulo";

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
    const resultado = verificarCadeia({ empresaId: EMPRESA, fuso: SP, registros: [...registros].reverse(), controle: controle });
    expect(resultado.problemas).toEqual([]);
    expect(resultado.ultimoNsr).toBe(4);
  });

  it("aponta marcação alterada depois do registro", () => {
    const { registros, controle } = cadeia(3);
    registros[1].dados.horaLocal = "07:00:00";
    const { problemas } = verificarCadeia({ empresaId: EMPRESA, fuso: SP, registros: registros, controle: controle });
    expect(problemas).toHaveLength(1);
    expect(problemas[0]).toMatchObject({ nsr: 2, registroId: "r2" });
    expect(problemas[0].descricao).toMatch(/alterados/);
  });

  it("aponta marcação apagada no meio e no fim da sequência", () => {
    const { registros, controle } = cadeia(4);
    const semAMeio = registros.filter((r) => r.id !== "r2");
    const meio = verificarCadeia({ empresaId: EMPRESA, fuso: SP, registros: semAMeio, controle: controle }).problemas.map((p) => p.descricao).join(" | ");
    expect(meio).toMatch(/NSR 2 não encontrado/);
    expect(meio).toMatch(/não encadeia/);

    const fim = verificarCadeia({ empresaId: EMPRESA, fuso: SP, registros: registros.slice(0, 3), controle: controle }).problemas;
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
    const { problemas } = verificarCadeia({ empresaId: EMPRESA, fuso: SP, registros: registros, controle: controle });
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
    expect(verificarCadeia({ empresaId: EMPRESA, fuso: SP, registros: registros, controle: integra }).problemas).toEqual([]);
    expect(r2.hash).not.toBe(hashDoRegistro({ ...(r2 as unknown as Parameters<typeof hashDoRegistro>[0]), dataHora, semInternet: null }));

    // Apagar a marca "sem internet" (ou o "conferir horário") direto no banco quebra a cadeia.
    delete r2.semInternet;
    expect(verificarCadeia({ empresaId: EMPRESA, fuso: SP, registros: registros, controle: integra }).problemas[0]?.descricao).toMatch(/alterados/);
    r2.semInternet = { recebidoEm: { toDate: () => recebidoEm } as unknown as Timestamp, conferir: true };
    expect(verificarCadeia({ empresaId: EMPRESA, fuso: SP, registros: registros, controle: integra }).problemas[0]?.descricao).toMatch(/alterados/);
    expect(verificarCadeia({ empresaId: EMPRESA, fuso: SP, registros: registros, controle: controle }).problemas.length).toBeGreaterThan(0);
  });

  it("ARP: operações do REP (empregador e empregados) e marcações na mesma sequência, com o hash SHA-256 do AFD", () => {
    const empregador: OperacaoRep = { tipo: 2, tpIdtEmpregador: "1", idtEmpregador: "11222333000181", cnoCaepf: "", razaoSocial: "Loja", local: "Rua A, 1", cpfResponsavel: "" };
    const empregado: OperacaoRep = { tipo: 5, operacao: "I", cpf: "52998224725", nome: "Maria", demais: "", cpfResponsavel: "11144477735" };
    const gravadoEm = new Date(Date.UTC(2026, 9, 5, 10, 0, 0));
    const ts = (d: Date) => ({ toDate: () => d }) as unknown as Timestamp;
    const operacoes: Array<{ id: string; dados: Record<string, unknown> }> = [];
    let hashAnterior = HASH_INICIAL;
    for (const [i, operacao] of [empregador, empregado].entries()) {
      const nsr = i + 1;
      const hash = hashDaOperacao({ hashAnterior, nsr, empresaId: EMPRESA, gravadoEm, operacao });
      operacoes.push({ id: String(nsr).padStart(9, "0"), dados: { ...operacao, nsr, gravadoEm: ts(gravadoEm), hash, hashAnterior } });
      hashAnterior = hash;
    }
    // Marcação (NSR 3) com o hash SHA-256 do AFD encadeado.
    const dataHora = new Date(Date.UTC(2026, 9, 5, 11, 0, 0));
    const campos = {
      hashAnterior,
      nsr: 3,
      empresaId: EMPRESA,
      funcionarioId: "f1",
      funcionarioCpf: "52998224725",
      dataHora,
      dataLocal: "2026-10-05",
      horaLocal: "08:00:00",
      fotoSha256: "a".repeat(64),
      dispositivoId: "disp_1",
    };
    const hash = hashDoRegistro(campos);
    const hashRep = hashDaMarcacaoRep({ nsr: 3, dataHora, cpf: "52998224725", gravadoEm: dataHora, offline: false }, SP, "");
    const marcacao = { id: "r3", dados: { ...campos, funcionarioNome: "Maria", dataHora: ts(dataHora), hash, rep: { hash: hashRep, hashAnterior: "" } } };
    const controle = { ultimoNsr: 3, ultimoHash: hash, ultimoHashRep: hashRep };
    const verificar = () => verificarCadeia({ empresaId: EMPRESA, fuso: SP, registros: [marcacao], operacoes, controle });
    expect(verificar()).toEqual({ problemas: [], ultimoNsr: 3 });

    // Operação alterada direto no banco (ex.: trocar o nome do empregado).
    operacoes[1].dados.nome = "Outra";
    expect(verificar().problemas[0]).toMatchObject({ nsr: 2, descricao: expect.stringMatching(/alterados/) });
    operacoes[1].dados.nome = "Maria";

    // Operação apagada: falta o NSR, e a marcação não encadeia.
    const semEmpregado = verificarCadeia({ empresaId: EMPRESA, fuso: SP, registros: [marcacao], operacoes: [operacoes[0]], controle });
    expect(semEmpregado.problemas.map((p) => p.descricao).join(" | ")).toMatch(/NSR 2 não encontrado.*registro apagado/);

    // Hash SHA-256 do AFD adulterado na marcação.
    marcacao.dados.rep = { hash: "f".repeat(64), hashAnterior: "" };
    expect(verificar().problemas.map((p) => p.descricao).join(" | ")).toMatch(/código hash SHA-256 do AFD não confere/);
  });
});

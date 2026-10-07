import { describe, expect, it } from "vitest";
import * as funcoes from "./index";

// Pior caso: todas as funções com o máximo de cópias ao mesmo tempo. Precisa
// caber na cota do Cloud Run de um projeto novo, por região (ver admin.ts);
// assim o sistema nunca é barrado por ela, nem no meio de um deploy.
const COTA_VCPU = 20;
const COTA_INSTANCIAS = 100;

// CPU por cópia, como o Firebase CLI calcula: "gcf_gen1" acompanha a memória;
// sem cpu definida, a 2ª geração usa 1 vCPU (até 2GiB). Opção não definida
// chega como um marcador de "valor padrão" (objeto), não como número.
const CPU_GEN1: Record<number, number> = { 128: 0.0833, 256: 0.1666, 512: 0.3333, 1024: 0.5833, 2048: 1 };
const MEMORIA_PADRAO_MB = 256;

interface Endpoint {
  availableMemoryMb?: unknown;
  cpu?: unknown;
  maxInstances?: number;
}

const endpoints = Object.entries(funcoes).map(([nome, funcao]) => ({
  nome,
  ...(funcao as unknown as { __endpoint: Endpoint }).__endpoint,
}));

function cpuPorCopia({ availableMemoryMb, cpu }: Endpoint): number {
  const memoria = typeof availableMemoryMb === "number" ? availableMemoryMb : MEMORIA_PADRAO_MB;
  if (cpu === "gcf_gen1") return CPU_GEN1[memoria];
  return typeof cpu === "number" ? cpu : 1;
}

describe("cota de CPU do Cloud Run", () => {
  it("toda função tem um máximo de cópias", () => {
    expect(endpoints.length).toBeGreaterThan(20);
    for (const { nome, maxInstances } of endpoints) expect(maxInstances, nome).toBeGreaterThan(0);
  });

  it("todas as funções no máximo de cópias cabem na cota", () => {
    const vcpu = endpoints.reduce((soma, e) => soma + cpuPorCopia(e) * e.maxInstances!, 0);
    const copias = endpoints.reduce((soma, e) => soma + e.maxInstances!, 0);
    expect(vcpu).toBeLessThanOrEqual(COTA_VCPU);
    expect(copias).toBeLessThanOrEqual(COTA_INSTANCIAS);
  });
});

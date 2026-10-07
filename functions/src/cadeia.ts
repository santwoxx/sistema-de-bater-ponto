import type { Timestamp } from "firebase-admin/firestore";
import { sha256 } from "./seguranca";

// Cadeia de hashes das marcações feitas no aparelho: cada registro guarda o
// hash do anterior e um hash dos próprios dados (inclusive o da foto). Apagar,
// inserir ou alterar uma marcação, mesmo direto no Console do Firebase, quebra
// a cadeia, e a verificação abaixo aponta onde.

export const HASH_INICIAL = "0".repeat(64);

export interface CamposEncadeados {
  hashAnterior: string;
  nsr: number;
  empresaId: string;
  funcionarioId: string;
  funcionarioCpf: string;
  dataHora: Date;
  dataLocal: string;
  horaLocal: string;
  fotoSha256: string;
  dispositivoId: string;
}

export function hashDoRegistro(c: CamposEncadeados): string {
  return sha256(
    [
      c.hashAnterior,
      c.nsr,
      c.empresaId,
      c.funcionarioId,
      c.funcionarioCpf,
      c.dataHora.toISOString(),
      c.dataLocal,
      c.horaLocal,
      c.fotoSha256,
      c.dispositivoId,
    ].join("|"),
  );
}

export interface Problema {
  nsr: number | null;
  registroId: string | null;
  descricao: string;
}

interface RegistroEncadeado {
  id: string;
  dados: Record<string, unknown>;
}

/** Confere a sequência de NSR e a cadeia de hashes das marcações do aparelho. */
export function verificarCadeia(
  empresaId: string,
  registros: RegistroEncadeado[],
  controle: { ultimoNsr?: number; ultimoHash?: string } | undefined,
): { problemas: Problema[]; ultimoNsr: number } {
  const problemas: Problema[] = [];
  const ordenados = [...registros].sort((a, b) => Number(a.dados.nsr) - Number(b.dados.nsr));
  let hashAnterior = HASH_INICIAL;
  let esperado = 1;

  for (const { id, dados: r } of ordenados) {
    const nsr = Number(r.nsr);
    if (!Number.isInteger(nsr) || nsr < 1) {
      problemas.push({ nsr: null, registroId: id, descricao: "Marcação do aparelho sem NSR válido." });
      continue;
    }
    if (nsr < esperado) {
      problemas.push({ nsr, registroId: id, descricao: `NSR ${nsr} repetido.` });
    } else if (nsr > esperado) {
      const faixa = nsr - 1 > esperado ? `${esperado} a ${nsr - 1} não encontrados` : `${esperado} não encontrado`;
      problemas.push({ nsr: esperado, registroId: null, descricao: `NSR ${faixa}: marcação apagada?` });
    }

    const quando = `${String(r.dataLocal).split("-").reverse().join("/")} ${String(r.horaLocal).slice(0, 5)}`;
    if (r.hashAnterior !== hashAnterior) {
      problemas.push({ nsr, registroId: id, descricao: `NSR ${nsr} (${r.funcionarioNome}, ${quando}) não encadeia com a marcação anterior.` });
    }
    const dataHora = (r.dataHora as Timestamp | undefined)?.toDate?.();
    const calculado = dataHora
      ? hashDoRegistro({
          hashAnterior: String(r.hashAnterior),
          nsr,
          empresaId,
          funcionarioId: String(r.funcionarioId),
          funcionarioCpf: String(r.funcionarioCpf),
          dataHora,
          dataLocal: String(r.dataLocal),
          horaLocal: String(r.horaLocal),
          fotoSha256: String(r.fotoSha256),
          dispositivoId: String(r.dispositivoId),
        })
      : null;
    if (calculado !== r.hash) {
      problemas.push({ nsr, registroId: id, descricao: `NSR ${nsr} (${r.funcionarioNome}, ${quando}): dados alterados depois do registro.` });
    }
    hashAnterior = String(r.hash);
    esperado = Math.max(esperado, nsr + 1);
  }

  const ultimoNsr = esperado - 1;
  const contador = controle?.ultimoNsr ?? 0;
  if (contador !== ultimoNsr) {
    problemas.push({
      nsr: null,
      registroId: null,
      descricao: `O contador da empresa indica ${contador} marcação(ões) do aparelho, mas foram encontradas até o NSR ${ultimoNsr}: marcações apagadas no fim da sequência?`,
    });
  } else if (ultimoNsr > 0 && controle?.ultimoHash !== hashAnterior) {
    problemas.push({ nsr: ultimoNsr, registroId: null, descricao: "O hash da última marcação não confere com o guardado no contador da empresa." });
  }
  return { problemas, ultimoNsr };
}

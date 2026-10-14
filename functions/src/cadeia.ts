import type { Timestamp } from "firebase-admin/firestore";
import { hashDaMarcacaoRep, marcacaoRepDe, type OperacaoRep } from "./portaria671";
import { sha256 } from "./seguranca";

// Cadeia de hashes do registro de ponto (a ARP da Portaria 671): cada registro
// (marcação do aparelho ou operação do REP, como a inclusão de um empregado)
// tem o NSR seguinte, guarda o hash do anterior e um hash dos próprios dados
// (na marcação, inclusive o da foto). Apagar, inserir ou alterar um registro,
// mesmo direto no Console do Firebase, quebra a cadeia, e a verificação abaixo
// aponta onde. Cada marcação também tem o código hash SHA-256 do AFD, que é
// refeito aqui a partir dos dados que entram na cadeia.

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
  /** Batida feita sem internet e enviada depois: entra no hash, então não dá para esconder isso. */
  semInternet?: { recebidoEm: Date; conferir: boolean } | null;
}

export function hashDoRegistro(c: CamposEncadeados): string {
  const partes = [
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
  ];
  if (c.semInternet) partes.push("sem-internet", c.semInternet.recebidoEm.toISOString(), c.semInternet.conferir ? "conferir" : "ok");
  return sha256(partes.join("|"));
}

/** Hash de uma operação do REP (inclusão ou alteração do empregador ou de um empregado), na mesma cadeia das marcações. */
export function hashDaOperacao(c: { hashAnterior: string; nsr: number; empresaId: string; gravadoEm: Date; operacao: OperacaoRep }): string {
  const o = c.operacao;
  const campos =
    o.tipo === 2
      ? [o.tpIdtEmpregador, o.idtEmpregador, o.cnoCaepf, o.razaoSocial, o.local, o.cpfResponsavel]
      : [o.operacao, o.cpf, o.nome, o.demais, o.cpfResponsavel];
  return sha256([c.hashAnterior, c.nsr, c.empresaId, `tipo${o.tipo}`, c.gravadoEm.toISOString(), ...campos].join("|"));
}

/** Lê do registro gravado os dados da batida sem internet que entram no hash. */
function semInternetDoRegistro(valor: unknown): CamposEncadeados["semInternet"] {
  const s = valor as { recebidoEm?: Timestamp; conferir?: unknown } | null | undefined;
  const recebidoEm = s?.recebidoEm?.toDate?.();
  return recebidoEm ? { recebidoEm, conferir: s?.conferir === true } : null;
}

/** Operação do REP gravada na ARP (empresas/{id}/arp), sem os campos de controle. */
export function operacaoDoDocumento(dados: Record<string, unknown>): OperacaoRep | null {
  const texto = (campo: string) => String(dados[campo] ?? "");
  if (dados.tipo === 2) {
    return {
      tipo: 2,
      tpIdtEmpregador: texto("tpIdtEmpregador") === "2" ? "2" : "1",
      idtEmpregador: texto("idtEmpregador"),
      cnoCaepf: texto("cnoCaepf"),
      razaoSocial: texto("razaoSocial"),
      local: texto("local"),
      cpfResponsavel: texto("cpfResponsavel"),
    };
  }
  if (dados.tipo === 5) {
    const operacao = texto("operacao");
    return {
      tipo: 5,
      operacao: operacao === "A" || operacao === "E" ? operacao : "I",
      cpf: texto("cpf"),
      nome: texto("nome"),
      demais: texto("demais"),
      cpfResponsavel: texto("cpfResponsavel"),
    };
  }
  return null;
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

/**
 * Confere a sequência de NSR e a cadeia de hashes da ARP: marcações do aparelho
 * (registros) e operações do REP (arp), e o hash SHA-256 do AFD de cada marcação.
 */
export function verificarCadeia(params: {
  empresaId: string;
  /** Fuso da empresa (entra no hash SHA-256 do AFD). */
  fuso: string;
  registros: RegistroEncadeado[];
  operacoes?: RegistroEncadeado[];
  controle: { ultimoNsr?: number; ultimoHash?: string; ultimoHashRep?: string } | undefined;
}): { problemas: Problema[]; ultimoNsr: number } {
  const { empresaId, fuso, controle } = params;
  const problemas: Problema[] = [];
  const itens = [
    ...params.registros.map((r) => ({ ...r, operacao: false })),
    ...(params.operacoes ?? []).map((r) => ({ ...r, operacao: true })),
  ].sort((a, b) => Number(a.dados.nsr) - Number(b.dados.nsr));
  let hashAnterior = HASH_INICIAL;
  let hashRepAnterior = "";
  let esperado = 1;

  for (const { id, dados: r, operacao } of itens) {
    const nsr = Number(r.nsr);
    if (!Number.isInteger(nsr) || nsr < 1) {
      problemas.push({ nsr: null, registroId: id, descricao: "Registro de ponto sem NSR válido." });
      continue;
    }
    if (nsr < esperado) {
      problemas.push({ nsr, registroId: id, descricao: `NSR ${nsr} repetido.` });
    } else if (nsr > esperado) {
      const faixa = nsr - 1 > esperado ? `${esperado} a ${nsr - 1} não encontrados` : `${esperado} não encontrado`;
      problemas.push({ nsr: esperado, registroId: null, descricao: `NSR ${faixa}: registro apagado?` });
    }

    if (operacao) {
      const op = operacaoDoDocumento(r);
      const gravadoEm = (r.gravadoEm as Timestamp | undefined)?.toDate?.();
      const descricao = op?.tipo === 2 ? "identificação do empregador" : op ? `empregado ${op.nome}` : "operação";
      if (r.hashAnterior !== hashAnterior) {
        problemas.push({ nsr, registroId: id, descricao: `NSR ${nsr} (${descricao}) não encadeia com o registro anterior.` });
      }
      const calculado = op && gravadoEm ? hashDaOperacao({ hashAnterior: String(r.hashAnterior), nsr, empresaId, gravadoEm, operacao: op }) : null;
      if (calculado !== r.hash) {
        problemas.push({ nsr, registroId: id, descricao: `NSR ${nsr} (${descricao}): dados alterados depois do registro.` });
      }
    } else {
      const quando = `${String(r.dataLocal).split("-").reverse().join("/")} ${String(r.horaLocal).slice(0, 5)}`;
      if (r.hashAnterior !== hashAnterior) {
        problemas.push({ nsr, registroId: id, descricao: `NSR ${nsr} (${r.funcionarioNome}, ${quando}) não encadeia com o registro anterior.` });
      }
      const dataHora = (r.dataHora as Timestamp | undefined)?.toDate?.();
      const semInternet = semInternetDoRegistro(r.semInternet);
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
            semInternet,
          })
        : null;
      if (calculado !== r.hash) {
        problemas.push({ nsr, registroId: id, descricao: `NSR ${nsr} (${r.funcionarioNome}, ${quando}): dados alterados depois do registro.` });
      }

      // Hash SHA-256 do AFD: encadeado só entre as marcações. Nas gravadas antes
      // do REP-P (sem o campo "rep"), ele é só refeito, para seguir a sequência.
      if (dataHora) {
        const marcacao = marcacaoRepDe({
          nsr,
          dataHora,
          funcionarioCpf: String(r.funcionarioCpf),
          semInternetRecebidoEm: semInternet?.recebidoEm ?? null,
        });
        const rep = r.rep as { hash?: unknown; hashAnterior?: unknown } | undefined;
        if (rep) {
          if (rep.hashAnterior !== hashRepAnterior || hashDaMarcacaoRep(marcacao, fuso, String(rep.hashAnterior)) !== rep.hash) {
            problemas.push({ nsr, registroId: id, descricao: `NSR ${nsr} (${r.funcionarioNome}, ${quando}): o código hash SHA-256 do AFD não confere.` });
          }
          hashRepAnterior = String(rep.hash);
        } else {
          hashRepAnterior = hashDaMarcacaoRep(marcacao, fuso, hashRepAnterior);
        }
      }
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
      descricao: `O contador da empresa indica ${contador} registro(s), mas foram encontrados até o NSR ${ultimoNsr}: registros apagados no fim da sequência?`,
    });
  } else if (ultimoNsr > 0 && controle?.ultimoHash !== hashAnterior) {
    problemas.push({ nsr: ultimoNsr, registroId: null, descricao: "O hash do último registro não confere com o guardado no contador da empresa." });
  } else if (controle?.ultimoHashRep !== undefined && controle.ultimoHashRep !== hashRepAnterior) {
    problemas.push({ nsr: null, registroId: null, descricao: "O código hash SHA-256 da última marcação não confere com o guardado no contador da empresa." });
  }
  return { problemas, ultimoNsr };
}

import type { Timestamp } from "firebase-admin/firestore";
import { HttpsError, onCall } from "firebase-functions/https";
import { db } from "./admin";
import { autor, exigirAcessoEmpresa } from "./acesso";
import { registrarAuditoria } from "./auditoria";
import {
  calcularEspelho,
  classificar,
  documentoDoEspelho,
  ocorrenciasDoDia,
  rotuloTipo,
  type MarcacaoBruta,
  type ResumoEspelho,
} from "./espelho";
import { consumirLimite } from "./limites";
import { dataLocal } from "./tempo";
import { booleano, dataISO, idDocumento, listaIds, objeto, opcao } from "./validacao";

// Exportação dos dados de ponto de UMA empresa, com filtros (período,
// funcionários, situação, origem). É feita no servidor: lê só os campos
// necessários (sem as fotos) e não depende do limite de leitura da tela.

const TIPOS = ["marcacoes", "espelho-diario", "resumo", "espelhos"] as const;
type TipoExportacao = (typeof TIPOS)[number];

const ROTULOS: Record<TipoExportacao, string> = {
  marcacoes: "Marcações",
  "espelho-diario": "Espelho diário",
  resumo: "Resumo por funcionário",
  espelhos: "Espelhos para impressão",
};

const MAX_DIAS = 366;
const MAX_MARCACOES = 100_000;
const JORNADA_PADRAO = [0, 480, 480, 480, 480, 480, 240];
const DIAS_DA_SEMANA = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];
const CAMPOS_REGISTRO = [
  "funcionarioId",
  "funcionarioNome",
  "funcionarioMatricula",
  "funcionarioCpf",
  "dataLocal",
  "horaLocal",
  "origem",
  "dispositivoNome",
  "nsr",
  "hash",
  "justificativa",
  "incluidoPor",
  "desconsiderado",
];

type Celula = string | number | null;

interface Registro extends MarcacaoBruta {
  funcionarioId: string;
  funcionarioNome: string;
  funcionarioMatricula: string;
  funcionarioCpf: string;
  dispositivoNome?: string;
  nsr?: number;
  hash?: string;
  justificativa?: string;
  incluidoPor?: { nome: string };
  desconsiderado: { motivo: string } | null;
}

interface Funcionario {
  id: string;
  nome: string;
  cpf: string;
  matricula: string;
  cargo: string;
  admissao: string | null;
  jornada: number[];
}

const dataBR = (iso: string) => iso.split("-").reverse().join("/");

function diaDaSemana(iso: string): string {
  const [ano, mes, dia] = iso.split("-").map(Number);
  return DIAS_DA_SEMANA[new Date(Date.UTC(ano, mes - 1, dia)).getUTCDay()];
}

function hhmm(minutos: number, comSinal = false): string {
  const absoluto = Math.abs(Math.round(minutos));
  const texto = `${String(Math.floor(absoluto / 60)).padStart(2, "0")}:${String(absoluto % 60).padStart(2, "0")}`;
  if (minutos < 0) return `-${texto}`;
  return comSinal && absoluto > 0 ? `+${texto}` : texto;
}

function cpfFormatado(cpf: string): string {
  return /^\d{11}$/.test(cpf) ? `${cpf.slice(0, 3)}.${cpf.slice(3, 6)}.${cpf.slice(6, 9)}-${cpf.slice(9)}` : cpf;
}

function diasEntre(de: string, ate: string): number {
  const ms = (d: string) => {
    const [a, m, dia] = d.split("-").map(Number);
    return Date.UTC(a, m - 1, dia);
  };
  return Math.round((ms(ate) - ms(de)) / 86_400_000);
}

function mesesDoPeriodo(de: string, ate: string): string[] {
  const meses: string[] = [];
  const [ano, mes] = de.split("-").map(Number);
  for (let i = 0; ; i++) {
    const atual = new Date(Date.UTC(ano, mes - 1 + i, 1)).toISOString().slice(0, 7);
    if (atual > ate.slice(0, 7)) return meses;
    meses.push(atual);
  }
}

function paraArquivo(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function linhasDeMarcacoes(registros: Registro[], incluirDesconsideradas: boolean, origem: "todas" | "dispositivo" | "manual"): Celula[][] {
  // Entrada/saída vem da ordem das marcações válidas de cada pessoa no dia.
  const tipos = new Map<string, "entrada" | "saida">();
  const porDia = new Map<string, Registro[]>();
  for (const r of registros) {
    if (r.desconsiderado) continue;
    const chave = `${r.funcionarioId}|${r.dataLocal}`;
    porDia.set(chave, [...(porDia.get(chave) ?? []), r]);
  }
  for (const lista of porDia.values()) {
    for (const m of classificar(lista.sort((a, b) => a.horaLocal.localeCompare(b.horaLocal)))) tipos.set(m.id, m.tipo);
  }

  return registros
    .filter((r) => incluirDesconsideradas || !r.desconsiderado)
    .filter((r) => origem === "todas" || r.origem === origem)
    .sort(
      (a, b) =>
        a.dataLocal.localeCompare(b.dataLocal) ||
        a.funcionarioNome.localeCompare(b.funcionarioNome, "pt-BR") ||
        a.horaLocal.localeCompare(b.horaLocal),
    )
    .map((r) => [
      dataBR(r.dataLocal),
      diaDaSemana(r.dataLocal),
      r.horaLocal,
      r.funcionarioNome,
      r.funcionarioMatricula,
      cpfFormatado(r.funcionarioCpf),
      tipos.has(r.id) ? rotuloTipo(tipos.get(r.id)!) : "",
      r.origem === "manual" ? "Manual" : "Aparelho",
      r.dispositivoNome ?? "",
      r.nsr ?? "",
      r.desconsiderado ? "Desconsiderada" : "Válida",
      r.desconsiderado ? r.desconsiderado.motivo : (r.justificativa ?? ""),
      r.incluidoPor?.nome ?? "",
      r.hash ? r.hash.slice(0, 12).toUpperCase() : "",
    ]);
}

export const exportarDados = onCall({ timeoutSeconds: 300, memory: "1GiB" }, async (request) => {
  const dados = objeto(request.data);
  const empresaId = idDocumento(dados.empresaId, "Empresa");
  const { usuario, empresa } = await exigirAcessoEmpresa(request, empresaId);
  const tipo = opcao(dados.tipo, "Tipo de exportação", TIPOS);
  const de = dataISO(dados.de, "Data inicial");
  const ate = dataISO(dados.ate, "Data final");
  if (ate < de) throw new HttpsError("invalid-argument", "Período: a data final é anterior à inicial.");
  if (diasEntre(de, ate) >= MAX_DIAS) throw new HttpsError("invalid-argument", `Período: máximo de ${MAX_DIAS} dias por exportação.`);
  const escolhidos = dados.funcionarioIds == null ? null : new Set(listaIds(dados.funcionarioIds, "Funcionários", 1000));
  if (escolhidos && escolhidos.size === 0) throw new HttpsError("invalid-argument", "Funcionários: escolha pelo menos um.");
  const incluirDesconsideradas = dados.incluirDesconsideradas === undefined ? false : booleano(dados.incluirDesconsideradas, "Desconsideradas");
  const origem = dados.origem === undefined ? "todas" : opcao(dados.origem, "Origem", ["todas", "dispositivo", "manual"] as const);

  // Espelhos para impressão saem sempre com os meses inteiros.
  const meses = mesesDoPeriodo(de, ate);
  const deConsulta = tipo === "espelhos" ? `${meses[0]}-01` : de;
  const ateConsulta = tipo === "espelhos" ? `${meses[meses.length - 1]}-31` : ate;

  await consumirLimite(usuario.uid, "exportarDados");

  const empresaRef = db.doc(`empresas/${empresaId}`);
  const [funcionariosSnap, registrosSnap, abonosSnap, fechadosSnap] = await Promise.all([
    empresaRef.collection("funcionarios").get(),
    empresaRef
      .collection("registros")
      .where("dataLocal", ">=", deConsulta)
      .where("dataLocal", "<=", ateConsulta)
      .select(...CAMPOS_REGISTRO)
      .get(),
    tipo === "marcacoes"
      ? null
      : empresaRef.collection("abonos").where("data", ">=", deConsulta).where("data", "<=", ateConsulta).get(),
    tipo === "espelhos" ? empresaRef.collection("espelhos").where("mes", "in", meses.slice(0, 30)).get() : null,
  ]);
  if (registrosSnap.size > MAX_MARCACOES) {
    throw new HttpsError("resource-exhausted", "Período com marcações demais para um arquivo só. Divida em períodos menores.");
  }

  const registros = registrosSnap.docs
    .map((doc) => ({ id: doc.id, desconsiderado: null, ...doc.data() }) as Registro)
    .filter((r) => !escolhidos || escolhidos.has(r.funcionarioId));
  const comMarcacao = new Set(registros.map((r) => r.funcionarioId));
  const funcionarios: Funcionario[] = funcionariosSnap.docs
    .filter((doc) => (escolhidos ? escolhidos.has(doc.id) : doc.get("ativo") === true || comMarcacao.has(doc.id)))
    .map((doc) => {
      const f = doc.data();
      return {
        id: doc.id,
        nome: f.nome,
        cpf: f.cpf,
        matricula: f.matricula,
        cargo: f.cargo ?? "",
        admissao: f.admissao ?? null,
        jornada: Array.isArray(f.jornada) && f.jornada.length === 7 ? f.jornada : JORNADA_PADRAO,
      };
    })
    .sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));

  const nomeArquivo = `${paraArquivo(empresa.nome)}_${tipo}_${de}_a_${ate}.csv`;
  let resultado: { linhas?: Celula[][]; espelhos?: unknown[]; quantidade: number };

  if (tipo === "marcacoes") {
    const linhas = linhasDeMarcacoes(registros, incluirDesconsideradas, origem);
    resultado = {
      quantidade: linhas.length,
      linhas: [
        [
          "Data",
          "Dia",
          "Hora",
          "Funcionário",
          "Matrícula",
          "CPF",
          "Tipo",
          "Origem",
          "Aparelho",
          "NSR",
          "Situação",
          "Justificativa / motivo",
          "Incluída por",
          "Código de verificação",
        ],
        ...linhas,
      ],
    };
  } else {
    // Espelho de cada funcionário em cada mês do período, com o mesmo cálculo do painel.
    const abonos = (abonosSnap?.docs ?? []).map((doc) => ({
      id: doc.id,
      data: doc.get("data") as string,
      tipo: doc.get("tipo") as string,
      descricao: doc.get("descricao") as string,
      minutos: (doc.get("minutos") as number | null) ?? null,
      funcionarioId: (doc.get("funcionarioId") as string | null) ?? null,
    }));
    const hoje = dataLocal(new Date(), empresa.fusoHorario);
    const registrosPorFuncionario = new Map<string, Registro[]>();
    for (const r of registros) registrosPorFuncionario.set(r.funcionarioId, [...(registrosPorFuncionario.get(r.funcionarioId) ?? []), r]);
    const calcular = (f: Funcionario, mes: string): ResumoEspelho =>
      calcularEspelho({
        mes,
        registros: registrosPorFuncionario.get(f.id) ?? [],
        jornada: f.jornada,
        hoje,
        admissao: f.admissao,
        inicioControle: empresa.inicioControle,
        abonos: abonos.filter((a) => a.funcionarioId === null || a.funcionarioId === f.id),
        toleranciaMin: empresa.toleranciaMinutos,
      });
    const noPeriodo = (data: string) => data >= de && data <= ate;

    if (tipo === "espelho-diario") {
      const linhas: Celula[][] = [];
      for (const f of funcionarios) {
        for (const mes of meses) {
          for (const d of calcular(f, mes).dias.filter((dia) => noPeriodo(dia.data))) {
            linhas.push([
              dataBR(d.data),
              diaDaSemana(d.data),
              f.nome,
              f.matricula,
              d.marcacoes.map((m) => `${m.hora}${m.manual ? "*" : ""}`).join(" "),
              hhmm(d.previstoMin),
              hhmm(d.trabalhadoMin),
              d.saldoMin === null ? "" : hhmm(d.saldoMin, true),
              ocorrenciasDoDia(d).join(" · "),
            ]);
          }
        }
      }
      resultado = {
        quantidade: linhas.length,
        linhas: [["Data", "Dia", "Funcionário", "Matrícula", "Marcações (* manual)", "Previsto", "Trabalhado", "Saldo", "Ocorrências"], ...linhas],
      };
    } else if (tipo === "resumo") {
      const linhas: Celula[][] = funcionarios.map((f) => {
        const dias = meses.flatMap((mes) => calcular(f, mes).dias).filter((d) => noPeriodo(d.data));
        const fechados = dias.filter((d) => d.saldoMin !== null);
        return [
          f.nome,
          f.matricula,
          cpfFormatado(f.cpf),
          f.cargo,
          dias.filter((d) => d.marcacoes.length > 0).length,
          hhmm(fechados.reduce((s, d) => s + d.previstoMin, 0)),
          hhmm(dias.reduce((s, d) => s + d.trabalhadoMin, 0)),
          hhmm(fechados.reduce((s, d) => s + (d.saldoMin ?? 0), 0), true),
          dias.filter((d) => d.falta).length,
          dias.filter((d) => d.incompleto).length,
          dias.filter((d) => d.abonos.length > 0).length,
        ];
      });
      resultado = {
        quantidade: linhas.length,
        linhas: [
          [`Resumo de ${dataBR(de)} a ${dataBR(ate)} - ${empresa.nome}`],
          [
            "Funcionário",
            "Matrícula",
            "CPF",
            "Cargo",
            "Dias trabalhados",
            "Previsto",
            "Trabalhado",
            "Saldo",
            "Faltas",
            "Dias com marcação ímpar",
            "Dias abonados",
          ],
          ...linhas,
        ],
      };
    } else {
      // Mês fechado sai com a versão oficial (a que foi assinada); mês aberto, com o cálculo atual.
      const fechados = new Map((fechadosSnap?.docs ?? []).map((doc) => [doc.id, doc.data()]));
      const millis = (t: Timestamp | null | undefined) => t?.toMillis() ?? null;
      const espelhos = funcionarios.flatMap((f) =>
        meses.map((mes) => {
          const fechado = fechados.get(`${f.id}_${mes}`);
          return {
            mes,
            funcionario: { id: f.id, nome: f.nome, cpf: f.cpf, matricula: f.matricula, cargo: f.cargo, admissao: f.admissao },
            documento: fechado?.documento ?? documentoDoEspelho(calcular(f, mes), empresa.toleranciaMinutos),
            fechamento: fechado
              ? {
                  status: fechado.status,
                  versao: fechado.versao,
                  fechadoEm: millis(fechado.fechadoEm),
                  fechadoPor: fechado.fechadoPor?.nome ?? "",
                  assinatura: fechado.assinatura
                    ? { em: millis(fechado.assinatura.em), codigo: fechado.assinatura.codigo, dispositivoNome: fechado.assinatura.dispositivoNome }
                    : null,
                  contestacao: fechado.contestacao ? { em: millis(fechado.contestacao.em), motivo: fechado.contestacao.motivo } : null,
                }
              : null,
          };
        }),
      );
      resultado = { quantidade: espelhos.length, espelhos };
    }
  }

  await registrarAuditoria({
    empresaId,
    autor: autor(usuario),
    acao: "dados.exportados",
    descricao:
      `Exportação "${ROTULOS[tipo]}" de ${dataBR(de)} a ${dataBR(ate)}: ` +
      `${escolhidos ? `${funcionarios.length} funcionário(s) escolhido(s)` : "todos os funcionários"}, ${resultado.quantidade} item(ns).`,
    detalhes: {
      tipo,
      de,
      ate,
      funcionarioIds: escolhidos ? [...escolhidos] : null,
      incluirDesconsideradas,
      origem,
      quantidade: resultado.quantidade,
    },
  });

  return { tipo, nomeArquivo, empresa: { nome: empresa.nome, cnpj: empresa.cnpj }, ...resultado };
});

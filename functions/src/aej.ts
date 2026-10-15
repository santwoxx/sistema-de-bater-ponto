import type { Timestamp } from "firebase-admin/firestore";
import { HttpsError } from "firebase-functions/https";
import { db } from "./admin";
import type { Empresa } from "./acesso";
import { ASSINATURA_EM_ARQUIVO, textoDoArquivo, type ArquivoRep } from "./afd";
import type { ConfiguracaoRep } from "./configuracaoRep";
import { calcularEspelho, type AbonoBruto } from "./espelho";
import { minutosDoPar, paresDoDia } from "./horario";
import { dataHoraRep, digitos, fixo, latin1, tipoDoIdentificador } from "./portaria671";
import { dataLocal } from "./tempo";

// Arquivo Eletrônico de Jornada - AEJ (Portaria 671, art. 83 e Anexo VI),
// gerado pelo programa de tratamento (o espelho): os vínculos, o horário
// contratual de cada um, todas as marcações do período (originais do REP,
// incluídas pelo gestor e desconsideradas, com o motivo) e as faltas. Texto
// ISO-8859-1, campos separados por "|", linhas terminadas em CR LF.

/** Campo do AEJ: numa linha só, sem o separador "|". */
function campo(valor: string | number): string {
  return latin1(String(valor)).replace(/\|/g, "/");
}

const linha = (...campos: Array<string | number>) => campos.map(campo).join("|");

/** "2026-12" → "2027-01". */
function proximoMes(mes: string): string {
  const [ano, numero] = mes.split("-").map(Number);
  return numero === 12 ? `${ano + 1}-01` : `${ano}-${String(numero + 1).padStart(2, "0")}`;
}

/** "08:00" → "0800" (tipo H do AEJ). */
const hhmm = (hora: string) => hora.replace(":", "");

interface RegistroAej {
  funcionarioId: string;
  dataHora: Date;
  dataLocal: string;
  horaLocal: string;
  origem: "dispositivo" | "manual";
  desconsiderado: { motivo?: string } | null;
  justificativa: string;
}

export async function gerarAej(empresa: Empresa, de: string, ate: string, configuracao: ConfiguracaoRep, agora = new Date()): Promise<ArquivoRep> {
  if (!empresa.cnpj) throw new HttpsError("failed-precondition", "Cadastre o CNPJ da empresa (Empresas → editar) para gerar o AEJ.");
  const fuso = empresa.fusoHorario;
  const empresaRef = db.doc(`empresas/${empresa.id}`);
  const [funcionariosSnap, registrosSnap, abonosSnap] = await Promise.all([
    empresaRef.collection("funcionarios").get(),
    empresaRef
      .collection("registros")
      .where("dataLocal", ">=", de)
      .where("dataLocal", "<=", ate)
      .select("funcionarioId", "dataHora", "dataLocal", "horaLocal", "origem", "desconsiderado", "justificativa")
      .get(),
    empresaRef.collection("abonos").where("data", ">=", de).where("data", "<=", ate).get(),
  ]);

  const registros: RegistroAej[] = registrosSnap.docs.map((doc) => ({
    funcionarioId: String(doc.get("funcionarioId")),
    dataHora: (doc.get("dataHora") as Timestamp).toDate(),
    dataLocal: String(doc.get("dataLocal")),
    horaLocal: String(doc.get("horaLocal") ?? "00:00:00"),
    origem: doc.get("origem") === "manual" ? "manual" : "dispositivo",
    desconsiderado: (doc.get("desconsiderado") as { motivo?: string } | null | undefined) ?? null,
    justificativa: String(doc.get("justificativa") ?? ""),
  }));
  const comMarcacao = new Set(registros.map((r) => r.funcionarioId));
  // Vínculos: quem está ativo ou tem marcação no período.
  const vinculos = funcionariosSnap.docs
    .filter((doc) => doc.get("ativo") === true || comMarcacao.has(doc.id))
    .map((doc) => ({
      id: doc.id,
      nome: String(doc.get("nome") ?? ""),
      cpf: String(doc.get("cpf") ?? ""),
      horario: Array.isArray(doc.get("horario")) ? (doc.get("horario") as string[]) : null,
      jornada: Array.isArray(doc.get("jornada")) ? (doc.get("jornada") as number[]) : [0, 0, 0, 0, 0, 0, 0],
      admissao: (doc.get("admissao") as string | null | undefined) ?? null,
    }))
    .sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));

  const semHorario = vinculos.filter((v) => !v.horario).map((v) => v.nome);
  if (semHorario.length > 0) {
    const nomes = semHorario.slice(0, 10).join(", ") + (semHorario.length > 10 ? ` e mais ${semHorario.length - 10}` : "");
    throw new HttpsError("failed-precondition", `Cadastre o horário contratual (Funcionários → editar) de: ${nomes}. Ele vai no AEJ.`);
  }

  // Horários contratuais distintos (um código por combinação de pares do dia).
  const codigos = new Map<string, string>();
  const registros04: string[] = [];
  for (const v of vinculos) {
    for (const dia of v.horario ?? []) {
      const pares = paresDoDia(dia) ?? [];
      if (pares.length === 0 || codigos.has(dia)) continue;
      const codigo = `H${codigos.size + 1}`;
      codigos.set(dia, codigo);
      const minutos = pares.reduce((total, par) => total + minutosDoPar(par), 0);
      const horas = pares.flatMap((par) => [hhmm(par.entrada), hhmm(par.saida)]);
      // Com um par só, os campos do 2º par vão vazios; com 3 ou mais, os pares extras seguem em sequência.
      registros04.push(linha("04", codigo, minutos, ...horas, ...(pares.length === 1 ? ["", ""] : [])));
    }
  }

  const desenvolvedor = configuracao.desenvolvedor.documento;
  const linhas: string[] = [
    linha("01", tipoDoIdentificador(empresa.cnpj), empresa.cnpj, "", "", empresa.nome, de, ate, dataHoraRep(agora, fuso), "001"),
    linha("02", 1, 3, digitos(configuracao.inpi)),
    ...vinculos.map((v, i) => linha("03", i + 1, v.cpf, v.nome)),
    ...registros04,
  ];

  // Marcações de cada vínculo, dia a dia: as válidas viram entrada e saída, em pares.
  let semCodigo = 0;
  const registros05: string[] = [];
  for (const [i, v] of vinculos.entries()) {
    const doVinculo = registros.filter((r) => r.funcionarioId === v.id).sort((a, b) => a.dataHora.getTime() - b.dataHora.getTime());
    const dias = [...new Set(doVinculo.map((r) => r.dataLocal))].sort();
    for (const dia of dias) {
      let validas = 0;
      for (const r of doVinculo.filter((m) => m.dataLocal === dia)) {
        const desconsiderada = r.desconsiderado !== null;
        const tipo = desconsiderada ? "D" : validas % 2 === 0 ? "E" : "S";
        const par = desconsiderada ? 0 : Math.floor(validas / 2) + 1;
        if (!desconsiderada) validas += 1;
        let codigo = "";
        if (tipo === "E" && par === 1) {
          const [ano, mes, d] = dia.split("-").map(Number);
          codigo = codigos.get(v.horario?.[new Date(Date.UTC(ano, mes - 1, d)).getUTCDay()] ?? "") ?? "";
          if (!codigo) semCodigo += 1;
        }
        const motivo = desconsiderada ? String(r.desconsiderado?.motivo ?? "") : r.origem === "manual" ? r.justificativa : "";
        registros05.push(
          linha(
            "05",
            i + 1,
            dataHoraRep(r.dataHora, fuso),
            r.origem === "dispositivo" ? 1 : "",
            tipo,
            String(par).padStart(3, "0"),
            r.origem === "dispositivo" ? "O" : "I",
            codigo,
            motivo.slice(0, 150),
          ),
        );
      }
    }
  }
  linhas.push(...registros05);

  // Faltas não justificadas, pelo mesmo cálculo do espelho (abonos tiram a falta).
  const hoje = dataLocal(agora, fuso);
  const abonos = abonosSnap.docs.map((doc) => ({
    id: doc.id,
    data: String(doc.get("data")),
    tipo: String(doc.get("tipo")),
    descricao: String(doc.get("descricao") ?? ""),
    minutos: (doc.get("minutos") as number | null) ?? null,
    funcionarioId: (doc.get("funcionarioId") as string | null) ?? null,
  }));
  const meses: string[] = [];
  for (let mes = de.slice(0, 7); mes <= ate.slice(0, 7); mes = proximoMes(mes)) meses.push(mes);
  const registros07: string[] = [];
  for (const [i, v] of vinculos.entries()) {
    for (const mes of meses) {
      const resumo = calcularEspelho({
        mes,
        registros: registros
          .filter((r) => r.funcionarioId === v.id)
          .map((r, j) => ({ id: String(j), dataLocal: r.dataLocal, horaLocal: r.horaLocal, origem: r.origem, desconsiderado: r.desconsiderado })),
        jornada: v.jornada,
        hoje,
        admissao: v.admissao,
        inicioControle: empresa.inicioControle,
        abonos: abonos.filter((a) => a.funcionarioId === null || a.funcionarioId === v.id) as AbonoBruto[],
        toleranciaMin: empresa.toleranciaMinutos,
      });
      for (const d of resumo.dias) if (d.falta && d.data >= de && d.data <= ate) registros07.push(linha("07", i + 1, 2, d.data, "", ""));
    }
  }
  linhas.push(...registros07);

  linhas.push(
    linha(
      "08",
      configuracao.programa.nome,
      configuracao.programa.versao,
      desenvolvedor ? tipoDoIdentificador(desenvolvedor) : "",
      desenvolvedor,
      configuracao.desenvolvedor.nome,
      configuracao.desenvolvedor.email,
    ),
  );
  const quantos = (tipo: string) => linhas.filter((l) => l.startsWith(`${tipo}|`)).length;
  linhas.push(linha("99", ...["01", "02", "03", "04", "05", "06", "07", "08"].map(quantos)), fixo(ASSINATURA_EM_ARQUIVO, 100));

  const avisos: string[] = [];
  if (!configuracao.inpi) avisos.push("Número do registro no INPI não configurado (Administração → Portaria 671): vai em branco no arquivo.");
  if (!desenvolvedor) avisos.push("Dados do desenvolvedor não configurados (Administração → Portaria 671): vão em branco no arquivo.");
  if (semCodigo > 0) {
    avisos.push(`${semCodigo} primeira(s) entrada(s) em dia sem horário contratual (folga): saíram sem o código do horário.`);
  }
  return {
    nome: `AEJ_${empresa.cnpj}_${de}_${ate}.txt`,
    conteudo: textoDoArquivo(linhas),
    quantidade: registros05.length + registros07.length,
    avisos,
  };
}

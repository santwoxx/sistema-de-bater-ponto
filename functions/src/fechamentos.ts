import { FieldValue } from "firebase-admin/firestore";
import { HttpsError, onCall } from "firebase-functions/https";
import { db } from "./admin";
import { autor, exigirAcessoEmpresa } from "./acesso";
import { registrarAuditoria } from "./auditoria";
import { calcularEspelho, documentoDoEspelho, type AbonoBruto, type MarcacaoBruta } from "./espelho";
import { consumirLimite } from "./limites";
import { sha256 } from "./seguranca";
import { dataLocal } from "./tempo";
import { idDocumento, listaIds, objeto, texto } from "./validacao";

// Fechamento mensal: o servidor calcula o espelho de cada funcionário e guarda
// uma versão congelada (com hash), que o gestor imprime para o funcionário
// assinar em papel. Depois de fechado, o espelho só é refeito com motivo
// (reabertura), e a versão anterior fica guardada.

const JORNADA_PADRAO = [0, 480, 480, 480, 480, 480, 240];
const MESES = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];

export type ResultadoFechamento = "fechado" | "atualizado" | "sem-alteracoes" | "exige-motivo";

function nomeMes(mes: string): string {
  const [ano, numero] = mes.split("-").map(Number);
  return `${MESES[numero - 1]}/${ano}`;
}

function validarMes(valor: unknown, fuso: string): string {
  if (typeof valor !== "string" || !/^\d{4}-(0[1-9]|1[0-2])$/.test(valor)) {
    throw new HttpsError("invalid-argument", "Mês inválido (use AAAA-MM).");
  }
  if (valor >= dataLocal(new Date(), fuso).slice(0, 7)) {
    throw new HttpsError("failed-precondition", "Só é possível fechar meses que já terminaram.");
  }
  return valor;
}

export const fecharEspelhos = onCall({ timeoutSeconds: 120, memory: "512MiB", maxInstances: 2 }, async (request) => {
  const dados = objeto(request.data);
  const empresaId = idDocumento(dados.empresaId, "Empresa");
  const { usuario, empresa } = await exigirAcessoEmpresa(request, empresaId);
  const mes = validarMes(dados.mes, empresa.fusoHorario);
  const escolhidos = dados.funcionarioIds == null ? null : listaIds(dados.funcionarioIds, "Funcionários", 500);
  const motivoReabertura = dados.motivoReabertura ? texto(dados.motivoReabertura, "Motivo da reabertura", { min: 5, max: 300 }) : null;

  await consumirLimite(usuario.uid, "fecharEspelhos");

  const empresaRef = db.doc(`empresas/${empresaId}`);
  const [funcionarios, registros, abonosSnap] = await Promise.all([
    empresaRef.collection("funcionarios").get(),
    // Só os campos do cálculo: sem as miniaturas das fotos, que pesariam na memória.
    empresaRef
      .collection("registros")
      .where("dataLocal", ">=", `${mes}-01`)
      .where("dataLocal", "<=", `${mes}-31`)
      .select("funcionarioId", "dataLocal", "horaLocal", "origem", "desconsiderado")
      .get(),
    empresaRef.collection("abonos").where("data", ">=", `${mes}-01`).where("data", "<=", `${mes}-31`).get(),
  ]);

  const registrosPorFuncionario = new Map<string, MarcacaoBruta[]>();
  for (const doc of registros.docs) {
    const r = doc.data();
    const lista = registrosPorFuncionario.get(r.funcionarioId) ?? [];
    lista.push({ id: doc.id, dataLocal: r.dataLocal, horaLocal: r.horaLocal, origem: r.origem, desconsiderado: r.desconsiderado });
    registrosPorFuncionario.set(r.funcionarioId, lista);
  }
  const abonos = abonosSnap.docs.map((doc) => ({
    id: doc.id,
    data: doc.get("data") as string,
    tipo: doc.get("tipo") as string,
    descricao: doc.get("descricao") as string,
    minutos: (doc.get("minutos") as number | null) ?? null,
    funcionarioId: (doc.get("funcionarioId") as string | null) ?? null,
  }));

  // Sem lista explícita: todos os ativos, mais quem tiver marcação no mês.
  const alvos = funcionarios.docs.filter((doc) =>
    escolhidos ? escolhidos.includes(doc.id) : doc.get("ativo") === true || registrosPorFuncionario.has(doc.id),
  );
  if (alvos.length === 0) throw new HttpsError("failed-precondition", "Nenhum funcionário para fechar neste mês.");

  const hoje = dataLocal(new Date(), empresa.fusoHorario);
  const resultados: Array<{ funcionarioId: string; nome: string; resultado: ResultadoFechamento }> = [];

  for (const funcionarioDoc of alvos) {
    const f = funcionarioDoc.data();
    const doFuncionario: AbonoBruto[] = abonos.filter((a) => a.funcionarioId === null || a.funcionarioId === funcionarioDoc.id);
    const resumo = calcularEspelho({
      mes,
      registros: registrosPorFuncionario.get(funcionarioDoc.id) ?? [],
      jornada: Array.isArray(f.jornada) && f.jornada.length === 7 ? f.jornada : JORNADA_PADRAO,
      hoje,
      admissao: f.admissao ?? null,
      inicioControle: empresa.inicioControle,
      abonos: doFuncionario,
      toleranciaMin: empresa.toleranciaMinutos,
    });
    const conteudo = {
      mes,
      empresa: { id: empresa.id, nome: empresa.nome, cnpj: empresa.cnpj },
      funcionario: {
        id: funcionarioDoc.id,
        nome: f.nome,
        cpf: f.cpf,
        matricula: f.matricula,
        cargo: f.cargo ?? "",
        admissao: f.admissao ?? null,
      },
      documento: documentoDoEspelho(resumo, empresa.toleranciaMinutos),
    };
    const hash = sha256(JSON.stringify(conteudo));
    const ref = empresaRef.collection("espelhos").doc(`${funcionarioDoc.id}_${mes}`);

    const resultado = await db.runTransaction<ResultadoFechamento>(async (tx) => {
      const atual = (await tx.get(ref)).data();
      if (atual && atual.hash === hash) return "sem-alteracoes";
      // Já fechado (e talvez impresso e assinado): mudar exige motivo.
      if (atual && !motivoReabertura) return "exige-motivo";
      if (atual) tx.set(ref.collection("versoes").doc(String(atual.versao)), atual);
      tx.set(ref, {
        ...conteudo,
        funcionarioId: funcionarioDoc.id,
        hash,
        versao: (atual?.versao ?? 0) + 1,
        status: "fechado",
        fechadoPor: autor(usuario),
        fechadoEm: FieldValue.serverTimestamp(),
        reabertura: atual ? { motivo: motivoReabertura, versaoAnterior: atual.versao } : null,
      });
      return atual ? "atualizado" : "fechado";
    });
    resultados.push({ funcionarioId: funcionarioDoc.id, nome: f.nome, resultado });
  }

  const contar = (r: ResultadoFechamento) => resultados.filter((x) => x.resultado === r).length;
  await registrarAuditoria({
    empresaId,
    autor: autor(usuario),
    acao: "espelho.fechado",
    descricao:
      `Fechamento de ${nomeMes(mes)}: ${contar("fechado")} fechado(s), ${contar("atualizado")} atualizado(s), ` +
      `${contar("sem-alteracoes")} sem alterações, ${contar("exige-motivo")} com mudanças aguardando motivo para reabrir.`,
    detalhes: { mes, resultados, ...(motivoReabertura ? { motivo: motivoReabertura } : {}) },
  });

  return { resultados };
});

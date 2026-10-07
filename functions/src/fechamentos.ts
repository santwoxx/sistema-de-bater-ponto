import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { HttpsError, onCall } from "firebase-functions/https";
import { db } from "./admin";
import { autor, exigirAcessoEmpresa, exigirDispositivo } from "./acesso";
import { auditarNa, registrarAuditoria } from "./auditoria";
import { calcularEspelho, documentoDoEspelho, type AbonoBruto, type MarcacaoBruta } from "./espelho";
import { decodificarJpeg, identificarNoAparelho, lerMatriculaPin, MAX_MINIATURA_BYTES } from "./identificacao";
import { consumirLimite } from "./limites";
import { sha256 } from "./seguranca";
import { dataLocal } from "./tempo";
import { booleano, idDocumento, listaIds, objeto, texto } from "./validacao";

// Fechamento mensal: o servidor calcula o espelho de cada funcionário e guarda
// uma versão congelada (com hash). O funcionário confere no aparelho de ponto
// e assina (concorda) ou contesta, com matrícula + PIN e foto. Um espelho
// assinado só é refeito com motivo, e a versão anterior fica guardada.

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

export const fecharEspelhos = onCall({ timeoutSeconds: 120, memory: "512MiB" }, async (request) => {
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
      const reenviarContestado = atual?.status === "contestado" && motivoReabertura !== null;
      if (atual && atual.hash === hash && !reenviarContestado) return "sem-alteracoes";
      if (atual?.status === "assinado" && !motivoReabertura) return "exige-motivo";
      if (atual) tx.set(ref.collection("versoes").doc(String(atual.versao)), atual);
      tx.set(ref, {
        ...conteudo,
        funcionarioId: funcionarioDoc.id,
        hash,
        versao: (atual?.versao ?? 0) + 1,
        status: "aguardando",
        fechadoPor: autor(usuario),
        fechadoEm: FieldValue.serverTimestamp(),
        assinatura: null,
        contestacao: null,
        reabertura: atual ? { motivo: motivoReabertura ?? "Atualizado antes da assinatura", statusAnterior: atual.status } : null,
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
      `${contar("sem-alteracoes")} sem alterações, ${contar("exige-motivo")} assinado(s) aguardando motivo para reabrir.`,
    detalhes: { mes, resultados, ...(motivoReabertura ? { motivo: motivoReabertura } : {}) },
  });

  return { resultados };
});

// --- No aparelho de ponto, com matrícula + PIN ------------------------------

export const consultarEspelhosPendentes = onCall(async (request) => {
  const { dispositivoId, empresaId } = exigirDispositivo(request);
  const { matricula, pin } = lerMatriculaPin(objeto(request.data));
  const { empresaRef, funcionarioId, funcionario } = await identificarNoAparelho({ empresaId, dispositivoId, matricula, pin });

  const pendentes = await empresaRef
    .collection("espelhos")
    .where("funcionarioId", "==", funcionarioId)
    .where("status", "==", "aguardando")
    .get();

  return {
    funcionarioNome: funcionario.nome as string,
    espelhos: pendentes.docs
      .map((doc) => {
        const e = doc.data();
        return {
          id: doc.id,
          mes: e.mes as string,
          hash: e.hash as string,
          empresaNome: e.empresa?.nome as string,
          funcionario: { nome: e.funcionario?.nome, matricula: e.funcionario?.matricula, cargo: e.funcionario?.cargo },
          documento: e.documento,
        };
      })
      .sort((a, b) => a.mes.localeCompare(b.mes)),
  };
});

export const assinarEspelho = onCall(async (request) => {
  const { dispositivoId, empresaId } = exigirDispositivo(request);
  const dados = objeto(request.data);
  const { matricula, pin } = lerMatriculaPin(dados);
  const espelhoId = idDocumento(dados.espelhoId, "Espelho");
  if (typeof dados.hash !== "string" || !/^[0-9a-f]{64}$/.test(dados.hash)) throw new HttpsError("invalid-argument", "Versão do espelho inválida.");
  const hash = dados.hash;
  const concordo = booleano(dados.concordo, "Concordância");
  const motivo = concordo ? null : texto(dados.motivo, "Motivo", { min: 5, max: 500 });
  const miniatura = dados.miniatura ? decodificarJpeg(dados.miniatura, "Foto", MAX_MINIATURA_BYTES) : null;

  const { empresaRef, dispositivo, funcionarioId, funcionario } = await identificarNoAparelho({
    empresaId,
    dispositivoId,
    matricula,
    pin,
    miniatura,
  });
  const ref = empresaRef.collection("espelhos").doc(espelhoId);
  const agora = new Date();
  // Código que identifica esta assinatura: espelho (hash) + quem + quando + onde.
  const codigo = sha256([hash, funcionarioId, agora.toISOString(), dispositivoId].join("|")).slice(0, 16).toUpperCase();

  const mes = await db.runTransaction(async (tx) => {
    const espelho = (await tx.get(ref)).data();
    if (!espelho || espelho.funcionarioId !== funcionarioId) throw new HttpsError("not-found", "Espelho não encontrado.");
    if (espelho.status !== "aguardando") throw new HttpsError("failed-precondition", "Este espelho não está aguardando assinatura.");
    if (espelho.hash !== hash) {
      throw new HttpsError("failed-precondition", "O espelho foi atualizado pelo gestor. Consulte de novo para ver a versão atual.");
    }
    const registro = {
      em: Timestamp.fromDate(agora),
      codigo,
      hash,
      dispositivoId,
      dispositivoNome: dispositivo.nome,
      miniatura: miniatura ? `data:image/jpeg;base64,${miniatura.toString("base64")}` : null,
    };
    tx.update(ref, concordo ? { status: "assinado", assinatura: registro } : { status: "contestado", contestacao: { ...registro, motivo } });
    const mesEspelho = espelho.mes as string;
    auditarNa(tx, {
      empresaId,
      autor: { uid: funcionarioId, nome: String(funcionario.nome) },
      acao: concordo ? "espelho.assinado" : "espelho.contestado",
      descricao: concordo
        ? `${funcionario.nome} assinou o espelho de ${nomeMes(mesEspelho)} no aparelho "${dispositivo.nome}" (código ${codigo}).`
        : `${funcionario.nome} contestou o espelho de ${nomeMes(mesEspelho)} no aparelho "${dispositivo.nome}": ${motivo}.`,
      detalhes: { espelhoId, mes: mesEspelho, codigo, hash, ...(motivo ? { motivo } : {}) },
    });
    return mesEspelho;
  });

  return { status: concordo ? "assinado" : "contestado", mes, codigo };
});

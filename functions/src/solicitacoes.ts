import { FieldValue, type DocumentData, type QuerySnapshot, type Transaction } from "firebase-admin/firestore";
import { HttpsError, onCall } from "firebase-functions/https";
import { db } from "./admin";
import { autor, exigirAcessoEmpresa, type Autor } from "./acesso";
import { consultaDoDia, existeNoMesmoMinuto, marcacaoManual } from "./ajustes";
import { auditarNa } from "./auditoria";
import { dataLocal, localParaUtc } from "./tempo";
import { booleano, dataISO, horaHHMM, idDocumento, objeto, texto } from "./validacao";

// Solicitação de marcação: só o gestor, no painel, pede a inclusão de um
// horário que faltou (o funcionário só bate o ponto no aparelho, na hora). A
// marcação só passa a valer depois que um gestor aprova (ou na hora, com
// "aprovar agora").

const MAX_DIAS_ATRAS = 31;
const MAX_PENDENTES_POR_FUNCIONARIO = 10;

const formatar = (data: string) => data.split("-").reverse().join("/");

function diasEntre(de: string, ate: string): number {
  const ms = (d: string) => {
    const [a, m, dia] = d.split("-").map(Number);
    return Date.UTC(a, m - 1, dia);
  };
  return Math.round((ms(ate) - ms(de)) / 86_400_000);
}

/** Confere se o horário pedido está no passado e dentro do prazo. */
function validarMomento(data: string, hora: string, fuso: string): Date {
  const instante = localParaUtc(data, hora, fuso);
  if (instante.getTime() > Date.now() + 60_000) {
    throw new HttpsError("invalid-argument", "Não é possível solicitar uma marcação no futuro.");
  }
  if (diasEntre(data, dataLocal(new Date(), fuso)) > MAX_DIAS_ATRAS) {
    throw new HttpsError("invalid-argument", `Só é possível solicitar marcações dos últimos ${MAX_DIAS_ATRAS} dias.`);
  }
  return instante;
}

/** Evita pedido repetido e pedido de um horário que já tem marcação. */
async function conferirDuplicidade(empresaId: string, funcionarioId: string, data: string, hora: string): Promise<void> {
  const [pendentes, doDia] = await Promise.all([
    db.collection(`empresas/${empresaId}/solicitacoes`).where("funcionarioId", "==", funcionarioId).where("status", "==", "pendente").get(),
    consultaDoDia(empresaId, funcionarioId, data).get(),
  ]);
  if (pendentes.docs.some((doc) => doc.get("data") === data && doc.get("hora") === hora)) {
    throw new HttpsError("already-exists", "Já existe uma solicitação pendente para este dia e horário.");
  }
  if (pendentes.size >= MAX_PENDENTES_POR_FUNCIONARIO) {
    throw new HttpsError("resource-exhausted", "Há muitas solicitações pendentes para este funcionário. Analise as anteriores primeiro.");
  }
  if (existeNoMesmoMinuto(doDia, hora)) {
    throw new HttpsError("already-exists", `Já existe uma marcação às ${hora} em ${formatar(data)}.`);
  }
}

function dadosDoFuncionario(funcionarioId: string, funcionario: DocumentData) {
  return { funcionarioId, funcionarioNome: funcionario.nome, funcionarioMatricula: funcionario.matricula };
}

// --- Gestor, no painel -----------------------------------------------------

/**
 * Grava, dentro da transação, a marcação de uma solicitação aprovada e devolve
 * os campos que fecham a solicitação (o chamador os grava junto).
 */
function gravarMarcacaoAprovada(params: {
  tx: Transaction;
  empresaId: string;
  fuso: string;
  solicitacaoId: string;
  solicitacao: DocumentData;
  funcionario: DocumentData;
  doDia: QuerySnapshot;
  decididoPor: Autor;
}) {
  const { tx, empresaId, fuso, solicitacaoId, solicitacao, funcionario, doDia, decididoPor } = params;
  if (existeNoMesmoMinuto(doDia, solicitacao.hora)) {
    throw new HttpsError("already-exists", `Já existe uma marcação às ${solicitacao.hora} em ${formatar(solicitacao.data)}.`);
  }
  const registroRef = db.collection(`empresas/${empresaId}/registros`).doc();
  tx.set(
    registroRef,
    marcacaoManual({
      funcionarioId: solicitacao.funcionarioId,
      funcionario,
      instante: localParaUtc(solicitacao.data, solicitacao.hora, fuso),
      fuso,
      justificativa: `Solicitação registrada por ${solicitacao.solicitadoPor?.nome}: ${solicitacao.motivo}`,
      incluidoPor: decididoPor,
      solicitacaoId,
    }),
  );
  return {
    registroId: registroRef.id,
    fechamento: { status: "aprovada", decididoPor, decididoEm: FieldValue.serverTimestamp(), registroId: registroRef.id },
  };
}

export const criarSolicitacao = onCall(async (request) => {
  const dados = objeto(request.data);
  const empresaId = idDocumento(dados.empresaId, "Empresa");
  const { usuario, empresa } = await exigirAcessoEmpresa(request, empresaId);
  const funcionarioId = idDocumento(dados.funcionarioId, "Funcionário");
  const data = dataISO(dados.data, "Dia");
  const hora = horaHHMM(dados.hora, "Horário");
  const motivo = texto(dados.motivo, "Motivo", { min: 3, max: 300 });
  const aprovarAgora = dados.aprovarAgora === undefined ? false : booleano(dados.aprovarAgora, "Aprovar agora");

  const funcionarioRef = db.doc(`empresas/${empresaId}/funcionarios/${funcionarioId}`);
  const funcionario = (await funcionarioRef.get()).data();
  if (!funcionario) throw new HttpsError("not-found", "Funcionário não encontrado.");
  validarMomento(data, hora, empresa.fusoHorario);
  await conferirDuplicidade(empresaId, funcionarioId, data, hora);

  const solicitacaoRef = db.collection(`empresas/${empresaId}/solicitacoes`).doc();
  const solicitacao = {
    ...dadosDoFuncionario(funcionarioId, funcionario),
    data,
    hora,
    motivo,
    origem: "gestor",
    solicitadoPor: autor(usuario),
    status: "pendente",
    criadoEm: FieldValue.serverTimestamp(),
  };

  const registroId = await db.runTransaction(async (tx) => {
    let novoRegistro: string | null = null;
    if (aprovarAgora) {
      const doDia = await tx.get(consultaDoDia(empresaId, funcionarioId, data));
      const aprovacao = gravarMarcacaoAprovada({
        tx,
        empresaId,
        fuso: empresa.fusoHorario,
        solicitacaoId: solicitacaoRef.id,
        solicitacao,
        funcionario,
        doDia,
        decididoPor: autor(usuario),
      });
      tx.create(solicitacaoRef, { ...solicitacao, ...aprovacao.fechamento });
      novoRegistro = aprovacao.registroId;
    } else {
      tx.create(solicitacaoRef, solicitacao);
    }
    auditarNa(tx, {
      empresaId,
      autor: autor(usuario),
      acao: aprovarAgora ? "solicitacao.aprovada" : "solicitacao.criada",
      descricao:
        `Solicitação de marcação para ${funcionario.nome} em ${formatar(data)} às ${hora} registrada no painel` +
        `${aprovarAgora ? " e aprovada" : ""}: ${motivo}.`,
      detalhes: { solicitacaoId: solicitacaoRef.id, funcionarioId, data, hora, motivo, origem: "gestor", registroId: novoRegistro },
    });
    return novoRegistro;
  });

  return { id: solicitacaoRef.id, registroId };
});

export const decidirSolicitacao = onCall(async (request) => {
  const dados = objeto(request.data);
  const empresaId = idDocumento(dados.empresaId, "Empresa");
  const solicitacaoId = idDocumento(dados.solicitacaoId, "Solicitação");
  const { usuario, empresa } = await exigirAcessoEmpresa(request, empresaId);
  const aprovada = booleano(dados.aprovar, "Decisão");
  const motivoRecusa = aprovada ? null : texto(dados.motivoRecusa, "Motivo da recusa", { min: 3, max: 300 });

  const solicitacaoRef = db.doc(`empresas/${empresaId}/solicitacoes/${solicitacaoId}`);
  const registroId = await db.runTransaction(async (tx) => {
    const solicitacao = (await tx.get(solicitacaoRef)).data();
    if (!solicitacao) throw new HttpsError("not-found", "Solicitação não encontrada.");
    if (solicitacao.status !== "pendente") throw new HttpsError("failed-precondition", "Esta solicitação já foi analisada.");

    let novoRegistro: string | null = null;
    if (aprovada) {
      const [funcionarioSnap, doDia] = await Promise.all([
        tx.get(db.doc(`empresas/${empresaId}/funcionarios/${solicitacao.funcionarioId}`)),
        tx.get(consultaDoDia(empresaId, solicitacao.funcionarioId, solicitacao.data)),
      ]);
      const funcionario = funcionarioSnap.data();
      if (!funcionario) throw new HttpsError("not-found", "Funcionário não encontrado.");
      const aprovacao = gravarMarcacaoAprovada({
        tx,
        empresaId,
        fuso: empresa.fusoHorario,
        solicitacaoId,
        solicitacao,
        funcionario,
        doDia,
        decididoPor: autor(usuario),
      });
      tx.update(solicitacaoRef, aprovacao.fechamento);
      novoRegistro = aprovacao.registroId;
    } else {
      tx.update(solicitacaoRef, {
        status: "recusada",
        motivoRecusa,
        decididoPor: autor(usuario),
        decididoEm: FieldValue.serverTimestamp(),
      });
    }
    auditarNa(tx, {
      empresaId,
      autor: autor(usuario),
      acao: aprovada ? "solicitacao.aprovada" : "solicitacao.recusada",
      descricao:
        `Solicitação de ${solicitacao.funcionarioNome} para ${formatar(solicitacao.data)} às ${solicitacao.hora} ` +
        `${aprovada ? "aprovada: a marcação foi incluída" : `recusada: ${motivoRecusa}`}.`,
      detalhes: {
        solicitacaoId,
        funcionarioId: solicitacao.funcionarioId,
        registroId: novoRegistro,
        ...(motivoRecusa ? { motivo: motivoRecusa } : {}),
      },
    });
    return novoRegistro;
  });

  return { ok: true, registroId };
});

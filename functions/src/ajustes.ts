import { FieldValue, Timestamp, type DocumentData, type QuerySnapshot } from "firebase-admin/firestore";
import { HttpsError, onCall } from "firebase-functions/https";
import { db } from "./admin";
import { autor, exigirAcessoEmpresa, type Autor } from "./acesso";
import { auditarNa } from "./auditoria";
import { dataLocal, horaLocal, localParaUtc } from "./tempo";
import { dataISO, horaHHMM, idDocumento, objeto, texto } from "./validacao";

// Marcações originais NUNCA são alteradas nem apagadas. Correções são feitas
// incluindo uma marcação manual (com justificativa) ou desconsiderando uma
// marcação existente (com motivo). Tudo fica registrado na auditoria.

export function consultaDoDia(empresaId: string, funcionarioId: string, data: string) {
  return db.collection(`empresas/${empresaId}/registros`).where("funcionarioId", "==", funcionarioId).where("dataLocal", "==", data);
}

export function existeNoMesmoMinuto(doDia: QuerySnapshot, hora: string): boolean {
  return doDia.docs.some((doc) => !doc.get("desconsiderado") && String(doc.get("horaLocal")).slice(0, 5) === hora.slice(0, 5));
}

/** Dados de uma marcação manual (sem foto, sem NSR), pronta para gravar. */
export function marcacaoManual(params: {
  funcionarioId: string;
  funcionario: DocumentData;
  instante: Date;
  fuso: string;
  justificativa: string;
  incluidoPor: Autor;
  solicitacaoId?: string;
}) {
  const { funcionarioId, funcionario, instante, fuso, justificativa, incluidoPor, solicitacaoId } = params;
  return {
    funcionarioId,
    funcionarioNome: funcionario.nome,
    funcionarioMatricula: funcionario.matricula,
    funcionarioCpf: funcionario.cpf,
    dataHora: Timestamp.fromDate(instante),
    dataLocal: dataLocal(instante, fuso),
    horaLocal: horaLocal(instante, fuso),
    origem: "manual",
    justificativa,
    incluidoPor,
    ...(solicitacaoId ? { solicitacaoId } : {}),
    desconsiderado: null,
    criadoEm: FieldValue.serverTimestamp(),
  };
}

export const incluirMarcacao = onCall(async (request) => {
  const dados = objeto(request.data);
  const empresaId = idDocumento(dados.empresaId, "Empresa");
  const { usuario, empresa } = await exigirAcessoEmpresa(request, empresaId);
  const funcionarioId = idDocumento(dados.funcionarioId, "Funcionário");
  const data = dataISO(dados.data, "Data");
  const hora = horaHHMM(dados.hora, "Hora");
  const justificativa = texto(dados.justificativa, "Justificativa", { min: 5, max: 500 });

  const funcionarioSnap = await db.doc(`empresas/${empresaId}/funcionarios/${funcionarioId}`).get();
  const funcionario = funcionarioSnap.data();
  if (!funcionario) throw new HttpsError("not-found", "Funcionário não encontrado.");

  const instante = localParaUtc(data, hora, empresa.fusoHorario);
  if (instante.getTime() > Date.now() + 60_000) {
    throw new HttpsError("invalid-argument", "Não é possível incluir uma marcação no futuro.");
  }
  const dia = dataLocal(instante, empresa.fusoHorario);

  if (existeNoMesmoMinuto(await consultaDoDia(empresaId, funcionarioId, dia).get(), hora)) {
    throw new HttpsError("already-exists", `Já existe uma marcação às ${hora} neste dia.`);
  }

  const ref = db.collection(`empresas/${empresaId}/registros`).doc();
  const lote = db.batch();
  lote.create(
    ref,
    marcacaoManual({ funcionarioId, funcionario, instante, fuso: empresa.fusoHorario, justificativa, incluidoPor: autor(usuario) }),
  );
  auditarNa(lote, {
    empresaId,
    autor: autor(usuario),
    acao: "marcacao.incluida",
    descricao: `Marcação manual incluída para ${funcionario.nome} em ${dia.split("-").reverse().join("/")} às ${hora}.`,
    detalhes: { registroId: ref.id, funcionarioId, data: dia, hora, justificativa },
  });
  await lote.commit();

  return { id: ref.id };
});

export const desconsiderarMarcacao = onCall(async (request) => {
  const dados = objeto(request.data);
  const empresaId = idDocumento(dados.empresaId, "Empresa");
  const registroId = idDocumento(dados.registroId, "Marcação");
  const { usuario } = await exigirAcessoEmpresa(request, empresaId);
  const restaurar = dados.restaurar === true;
  const motivo = restaurar ? "" : texto(dados.motivo, "Motivo", { min: 5, max: 500 });

  const ref = db.doc(`empresas/${empresaId}/registros/${registroId}`);
  await db.runTransaction(async (tx) => {
    const registro = (await tx.get(ref)).data();
    if (!registro) throw new HttpsError("not-found", "Marcação não encontrada.");
    if (restaurar && !registro.desconsiderado) throw new HttpsError("failed-precondition", "Esta marcação já está válida.");
    if (!restaurar && registro.desconsiderado) throw new HttpsError("failed-precondition", "Esta marcação já foi desconsiderada.");

    tx.update(ref, {
      desconsiderado: restaurar ? null : { motivo, por: autor(usuario), em: FieldValue.serverTimestamp() },
    });
    const quando = `${String(registro.dataLocal).split("-").reverse().join("/")} às ${String(registro.horaLocal).slice(0, 5)}`;
    auditarNa(tx, {
      empresaId,
      autor: autor(usuario),
      acao: restaurar ? "marcacao.restaurada" : "marcacao.desconsiderada",
      descricao: `Marcação de ${registro.funcionarioNome} em ${quando} ${restaurar ? "voltou a valer" : "desconsiderada"}.`,
      detalhes: { registroId, funcionarioId: registro.funcionarioId, ...(restaurar ? {} : { motivo }) },
    });
  });

  return { ok: true };
});

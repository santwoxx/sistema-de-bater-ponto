import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { HttpsError, onCall } from "firebase-functions/https";
import { db } from "./admin";
import { autor, exigirAcessoEmpresa } from "./acesso";
import { registrarAuditoria } from "./auditoria";
import { dataLocal, horaLocal, localParaUtc } from "./tempo";
import { dataISO, horaHHMM, idDocumento, objeto, texto } from "./validacao";

// Marcações originais NUNCA são alteradas nem apagadas. Correções são feitas
// incluindo uma marcação manual (com justificativa) ou desconsiderando uma
// marcação existente (com motivo). Tudo fica registrado na auditoria.

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
  const horario = horaLocal(instante, empresa.fusoHorario);

  const registros = db.collection(`empresas/${empresaId}/registros`);
  const doDia = await registros.where("funcionarioId", "==", funcionarioId).where("dataLocal", "==", dia).get();
  const mesmoMinuto = doDia.docs.some(
    (doc) => !doc.get("desconsiderado") && String(doc.get("horaLocal")).slice(0, 5) === horario.slice(0, 5),
  );
  if (mesmoMinuto) throw new HttpsError("already-exists", `Já existe uma marcação às ${hora} neste dia.`);

  const ref = registros.doc();
  await ref.set({
    funcionarioId,
    funcionarioNome: funcionario.nome,
    funcionarioMatricula: funcionario.matricula,
    funcionarioCpf: funcionario.cpf,
    dataHora: Timestamp.fromDate(instante),
    dataLocal: dia,
    horaLocal: horario,
    origem: "manual",
    justificativa,
    incluidoPor: autor(usuario),
    desconsiderado: null,
    criadoEm: FieldValue.serverTimestamp(),
  });

  await registrarAuditoria({
    empresaId,
    autor: autor(usuario),
    acao: "marcacao.incluida",
    descricao: `Marcação manual incluída para ${funcionario.nome} em ${dia.split("-").reverse().join("/")} às ${hora}.`,
    detalhes: { registroId: ref.id, funcionarioId, data: dia, hora, justificativa },
  });

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
  const snap = await ref.get();
  const registro = snap.data();
  if (!registro) throw new HttpsError("not-found", "Marcação não encontrada.");
  if (restaurar && !registro.desconsiderado) throw new HttpsError("failed-precondition", "Esta marcação já está válida.");
  if (!restaurar && registro.desconsiderado) throw new HttpsError("failed-precondition", "Esta marcação já foi desconsiderada.");

  await ref.update({
    desconsiderado: restaurar ? null : { motivo, por: autor(usuario), em: FieldValue.serverTimestamp() },
  });

  const quando = `${String(registro.dataLocal).split("-").reverse().join("/")} às ${String(registro.horaLocal).slice(0, 5)}`;
  await registrarAuditoria({
    empresaId,
    autor: autor(usuario),
    acao: restaurar ? "marcacao.restaurada" : "marcacao.desconsiderada",
    descricao: `Marcação de ${registro.funcionarioNome} em ${quando} ${restaurar ? "voltou a valer" : "desconsiderada"}.`,
    detalhes: { registroId, funcionarioId: registro.funcionarioId, ...(restaurar ? {} : { motivo }) },
  });

  return { ok: true };
});

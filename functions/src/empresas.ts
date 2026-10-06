import { FieldValue } from "firebase-admin/firestore";
import { HttpsError, onCall } from "firebase-functions/https";
import { db } from "./admin";
import { PADROES_EMPRESA, autor, exigirAdmin } from "./acesso";
import { registrarAuditoria } from "./auditoria";
import { dataLocal } from "./tempo";
import { booleano, cnpjOpcional, dataISO, fusoHorario, idOpcional, inteiro, objeto, texto } from "./validacao";

export const salvarEmpresa = onCall(async (request) => {
  const usuario = await exigirAdmin(request);
  const dados = objeto(request.data);

  const id = idOpcional(dados.id, "Empresa");
  const nome = texto(dados.nome, "Nome", { min: 2, max: 120 });
  const cnpj = cnpjOpcional(dados.cnpj);
  const fuso = fusoHorario(dados.fusoHorario ?? PADROES_EMPRESA.fusoHorario);
  const intervaloMinimoMinutos = inteiro(
    dados.intervaloMinimoMinutos ?? PADROES_EMPRESA.intervaloMinimoMinutos,
    "Intervalo mínimo entre marcações",
    0,
    60,
  );
  const toleranciaMinutos = inteiro(dados.toleranciaMinutos ?? PADROES_EMPRESA.toleranciaMinutos, "Tolerância diária", 0, 60);
  const ativo = dados.ativo === undefined ? true : booleano(dados.ativo, "Ativo");
  // Início do controle de ponto: antes dele, dias sem marcação não contam como falta.
  // Na criação, assume a data de hoje; na edição, só muda se o campo for enviado.
  const inicioInformado = dados.inicioControle !== undefined;
  const inicioControle = dados.inicioControle ? dataISO(dados.inicioControle, "Início do controle") : null;

  if (cnpj) {
    const mesmoCnpj = await db.collection("empresas").where("cnpj", "==", cnpj).limit(2).get();
    if (mesmoCnpj.docs.some((doc) => doc.id !== id)) {
      throw new HttpsError("already-exists", "Já existe uma empresa com este CNPJ.");
    }
  }

  const ref = id ? db.doc(`empresas/${id}`) : db.collection("empresas").doc();
  if (id && !(await ref.get()).exists) throw new HttpsError("not-found", "Empresa não encontrada.");

  const agora = FieldValue.serverTimestamp();
  await ref.set(
    {
      nome,
      cnpj,
      fusoHorario: fuso,
      intervaloMinimoMinutos,
      toleranciaMinutos,
      ativo,
      atualizadoEm: agora,
      ...(id
        ? inicioInformado
          ? { inicioControle }
          : {}
        : { criadoEm: agora, inicioControle: inicioControle ?? dataLocal(new Date(), fuso) }),
    },
    { merge: true },
  );

  await registrarAuditoria({
    empresaId: null,
    autor: autor(usuario),
    acao: id ? "empresa.atualizada" : "empresa.criada",
    descricao: `Empresa "${nome}" ${id ? "atualizada" : "cadastrada"}.`,
    detalhes: {
      empresaId: ref.id,
      nome,
      cnpj,
      fusoHorario: fuso,
      intervaloMinimoMinutos,
      toleranciaMinutos,
      ativo,
      ...(inicioInformado ? { inicioControle } : {}),
    },
  });

  return { id: ref.id };
});

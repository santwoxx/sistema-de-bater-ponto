import { FieldValue } from "firebase-admin/firestore";
import { HttpsError, type CallableRequest } from "firebase-functions/https";
import { db } from "./admin";
import { autor, exigirAdmin } from "./acesso";
import { auditarNa } from "./auditoria";
import { cnpjValido, cpfValido, objeto, textoOpcional } from "./validacao";

// Dados do REP-P que valem para todas as empresas (Portaria 671): o número do
// registro do programa no INPI e a identificação do desenvolvedor, que vão no
// AFD, no AEJ e no comprovante do trabalhador. Ficam em sistema/rep; só o
// administrador lê e muda.

export interface ConfiguracaoRep {
  /** Número do registro do programa no INPI, só os dígitos ("" enquanto não houver). */
  inpi: string;
  desenvolvedor: {
    /** CNPJ (14 caracteres) ou CPF (11 dígitos) do desenvolvedor ("" se não informado). */
    documento: string;
    nome: string;
    email: string;
  };
  /** Nome e versão do programa de tratamento de registro de ponto (AEJ, tipo 08). */
  programa: { nome: string; versao: string };
}

const PROGRAMA_PADRAO = { nome: "Ponto Digital", versao: "1.0" };

export async function carregarConfiguracaoRep(): Promise<ConfiguracaoRep> {
  const dados = (await db.doc("sistema/rep").get()).data() ?? {};
  const texto = (valor: unknown) => (typeof valor === "string" ? valor : "");
  return {
    inpi: texto(dados.inpi),
    desenvolvedor: {
      documento: texto(dados.desenvolvedor?.documento),
      nome: texto(dados.desenvolvedor?.nome),
      email: texto(dados.desenvolvedor?.email),
    },
    programa: {
      nome: texto(dados.programa?.nome) || PROGRAMA_PADRAO.nome,
      versao: texto(dados.programa?.versao) || PROGRAMA_PADRAO.versao,
    },
  };
}

export async function salvarConfiguracaoRep(request: CallableRequest) {
  const usuario = await exigirAdmin(request);
  const dados = objeto(request.data);
  const inpi = textoOpcional(dados.inpi, "Número do registro no INPI", { max: 40 }).replace(/\D/g, "");
  if (inpi.length > 17) throw new HttpsError("invalid-argument", "Número do registro no INPI: no máximo 17 dígitos.");
  const documento = textoOpcional(dados.documento, "CNPJ ou CPF do desenvolvedor", { max: 20 })
    .replace(/[^0-9A-Za-z]/g, "")
    .toUpperCase();
  if (documento && !(documento.length === 11 ? cpfValido(documento) : cnpjValido(documento))) {
    throw new HttpsError("invalid-argument", "CNPJ ou CPF do desenvolvedor: número inválido.");
  }
  const nome = textoOpcional(dados.nome, "Nome do desenvolvedor", { max: 150 });
  const email = textoOpcional(dados.email, "E-mail do desenvolvedor", { max: 50 });
  if (email && !/^[^\s@|]+@[^\s@|]+\.[^\s@|]+$/.test(email)) throw new HttpsError("invalid-argument", "E-mail do desenvolvedor: formato inválido.");
  const programa = {
    nome: textoOpcional(dados.programaNome, "Nome do programa", { max: 150 }) || PROGRAMA_PADRAO.nome,
    versao: textoOpcional(dados.programaVersao, "Versão do programa", { max: 8 }) || PROGRAMA_PADRAO.versao,
  };

  const lote = db.batch();
  lote.set(db.doc("sistema/rep"), {
    inpi,
    desenvolvedor: { documento, nome, email },
    programa,
    atualizadoEm: FieldValue.serverTimestamp(),
    atualizadoPor: autor(usuario),
  });
  auditarNa(lote, {
    empresaId: null,
    autor: autor(usuario),
    acao: "rep.configurado",
    descricao: `Dados do REP-P (Portaria 671) atualizados: INPI ${inpi || "não informado"}, desenvolvedor ${nome || "não informado"}.`,
    detalhes: { inpi, documento, nome, email, programa },
  });
  await lote.commit();
  return { ok: true };
}

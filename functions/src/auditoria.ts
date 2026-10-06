import { FieldValue } from "firebase-admin/firestore";
import * as logger from "firebase-functions/logger";
import { db } from "./admin";
import type { Autor } from "./acesso";

// Toda ação administrativa deixa rastro: quem fez, o quê e quando.
// Ações de uma empresa ficam em empresas/{id}/auditoria; ações globais
// (usuários, criação de empresas) ficam em /auditoria.

interface EntradaAuditoria {
  empresaId: string | null;
  autor: Autor;
  acao: string;
  descricao: string;
  detalhes?: Record<string, unknown>;
}

export async function registrarAuditoria(entrada: EntradaAuditoria): Promise<void> {
  const colecao = entrada.empresaId
    ? db.collection(`empresas/${entrada.empresaId}/auditoria`)
    : db.collection("auditoria");
  try {
    await colecao.add({
      acao: entrada.acao,
      descricao: entrada.descricao,
      detalhes: entrada.detalhes ?? {},
      autor: entrada.autor,
      em: FieldValue.serverTimestamp(),
    });
  } catch (erro) {
    // A ação principal já foi concluída; uma falha aqui não deve desfazê-la.
    logger.error("Falha ao gravar auditoria", { acao: entrada.acao, erro });
  }
}

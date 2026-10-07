import { FieldValue, type Transaction, type WriteBatch } from "firebase-admin/firestore";
import * as logger from "firebase-functions/logger";
import { db } from "./admin";
import type { Autor } from "./acesso";

// Toda ação administrativa deixa rastro: quem fez, o quê e quando.
// Ações de uma empresa ficam em empresas/{id}/auditoria; ações globais
// (usuários, criação de empresas) ficam em /auditoria.

export interface EntradaAuditoria {
  empresaId: string | null;
  autor: Autor;
  acao: string;
  descricao: string;
  detalhes?: Record<string, unknown>;
}

function novaEntrada(entrada: EntradaAuditoria) {
  const colecao = entrada.empresaId ? db.collection(`empresas/${entrada.empresaId}/auditoria`) : db.collection("auditoria");
  return {
    ref: colecao.doc(),
    dados: {
      acao: entrada.acao,
      descricao: entrada.descricao,
      detalhes: entrada.detalhes ?? {},
      autor: entrada.autor,
      em: FieldValue.serverTimestamp(),
    },
  };
}

/**
 * Grava a auditoria na mesma transação (ou lote) da ação: as duas entram
 * juntas ou nenhuma entra, então não existe alteração sem rastro.
 */
export function auditarNa(escrita: Transaction | WriteBatch, entrada: EntradaAuditoria): void {
  const { ref, dados } = novaEntrada(entrada);
  escrita.create(ref, dados);
}

/** Auditoria avulsa, para ações que não gravam nada no banco (ex.: exportação). */
export async function registrarAuditoria(entrada: EntradaAuditoria): Promise<void> {
  const { ref, dados } = novaEntrada(entrada);
  try {
    await ref.create(dados);
  } catch (erro) {
    // A ação principal já foi concluída; uma falha aqui não deve desfazê-la.
    logger.error("Falha ao gravar auditoria", { acao: entrada.acao, erro });
  }
}

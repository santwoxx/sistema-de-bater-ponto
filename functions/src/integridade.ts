import { FieldValue } from "firebase-admin/firestore";
import { onCall } from "firebase-functions/https";
import * as logger from "firebase-functions/logger";
import { onSchedule } from "firebase-functions/scheduler";
import { db } from "./admin";
import { autor, exigirAcessoEmpresa, type Autor } from "./acesso";
import { auditarNa } from "./auditoria";
import { verificarCadeia, type Problema } from "./cadeia";
import { consumirLimite } from "./limites";
import { idDocumento, objeto } from "./validacao";

// Verificação da cadeia de hashes das marcações do aparelho (ver cadeia.ts):
// pelo gestor, na página de Auditoria, e automaticamente toda semana. O
// resultado fica em empresas/{id}.integridade para o painel avisar se algo
// foi adulterado.

const CAMPOS = [
  "nsr",
  "hash",
  "hashAnterior",
  "funcionarioId",
  "funcionarioNome",
  "funcionarioCpf",
  "dataHora",
  "dataLocal",
  "horaLocal",
  "fotoSha256",
  "dispositivoId",
];
const MAX_PROBLEMAS_NA_RESPOSTA = 200;
const VERIFICACAO_AUTOMATICA: Autor = { uid: "sistema", nome: "Verificação automática" };

interface ResultadoVerificacao {
  marcacoesAparelho: number;
  marcacoesManuais: number;
  ultimoNsr: number;
  problemas: Problema[];
}

async function verificarEmpresa(empresaId: string): Promise<ResultadoVerificacao> {
  const empresaRef = db.doc(`empresas/${empresaId}`);
  const [doAparelho, controle, manuais] = await Promise.all([
    empresaRef.collection("registros").where("origem", "==", "dispositivo").select(...CAMPOS).get(),
    empresaRef.collection("privado").doc("controle").get(),
    empresaRef.collection("registros").where("origem", "==", "manual").count().get(),
  ]);
  const { problemas, ultimoNsr } = verificarCadeia(
    empresaId,
    doAparelho.docs.map((doc) => ({ id: doc.id, dados: doc.data() })),
    controle.data(),
  );
  return { marcacoesAparelho: doAparelho.size, marcacoesManuais: manuais.data().count, ultimoNsr, problemas };
}

/**
 * Guarda o resultado na empresa (o painel mostra o alerta) e na auditoria: a
 * verificação manual sempre; a automática só quando encontra problema.
 */
async function registrarResultado(empresaId: string, resultado: ResultadoVerificacao, quem: Autor, automatica: boolean) {
  const { marcacoesAparelho, problemas } = resultado;
  const lote = db.batch();
  lote.update(db.doc(`empresas/${empresaId}`), {
    integridade: {
      verificadaEm: FieldValue.serverTimestamp(),
      automatica,
      marcacoes: marcacoesAparelho,
      problemas: problemas.length,
    },
  });
  if (!automatica || problemas.length > 0) {
    auditarNa(lote, {
      empresaId,
      autor: quem,
      acao: problemas.length > 0 ? "integridade.alerta" : "integridade.verificada",
      descricao:
        problemas.length === 0
          ? `Verificação de integridade: ${marcacoesAparelho} marcação(ões) do aparelho, cadeia íntegra.`
          : `Verificação de integridade: ${problemas.length} problema(s) em ${marcacoesAparelho} marcação(ões) do aparelho. ` +
            `Primeiro: ${problemas[0].descricao}`,
      detalhes: { marcacoesAparelho, problemas: problemas.length },
    });
  }
  await lote.commit();
}

export const verificarIntegridade = onCall({ timeoutSeconds: 300, memory: "1GiB" }, async (request) => {
  const dados = objeto(request.data);
  const empresaId = idDocumento(dados.empresaId, "Empresa");
  const { usuario } = await exigirAcessoEmpresa(request, empresaId);
  await consumirLimite(usuario.uid, "verificarIntegridade");

  const resultado = await verificarEmpresa(empresaId);
  await registrarResultado(empresaId, resultado, autor(usuario), false);
  return {
    marcacoesAparelho: resultado.marcacoesAparelho,
    marcacoesManuais: resultado.marcacoesManuais,
    ultimoNsr: resultado.ultimoNsr,
    totalProblemas: resultado.problemas.length,
    problemas: resultado.problemas.slice(0, MAX_PROBLEMAS_NA_RESPOSTA),
  };
});

// Toda segunda-feira às 3h (horário de Brasília), todas as empresas.
export const verificarIntegridadeSemanal = onSchedule(
  { schedule: "0 3 * * 1", timeZone: "America/Sao_Paulo", timeoutSeconds: 540, memory: "1GiB", retryCount: 1 },
  async () => {
    const empresas = await db.collection("empresas").select().get();
    for (const empresa of empresas.docs) {
      try {
        const resultado = await verificarEmpresa(empresa.id);
        await registrarResultado(empresa.id, resultado, VERIFICACAO_AUTOMATICA, true);
        const nivel = resultado.problemas.length > 0 ? "error" : "info";
        logger[nivel]("Verificação de integridade", {
          empresaId: empresa.id,
          marcacoes: resultado.marcacoesAparelho,
          problemas: resultado.problemas.length,
        });
      } catch (erro) {
        // Uma empresa com erro não impede a verificação das outras.
        logger.error("Falha na verificação de integridade", { empresaId: empresa.id, erro });
      }
    }
  },
);

import { onCall } from "firebase-functions/https";
import { db } from "./admin";
import { autor, exigirAcessoEmpresa } from "./acesso";
import { registrarAuditoria } from "./auditoria";
import { verificarCadeia } from "./cadeia";
import { idDocumento, objeto } from "./validacao";

// Verificação da cadeia de hashes das marcações do aparelho (ver cadeia.ts),
// pedida pelo gestor na página de Auditoria.

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

export const verificarIntegridade = onCall({ timeoutSeconds: 300, memory: "1GiB" }, async (request) => {
  const dados = objeto(request.data);
  const empresaId = idDocumento(dados.empresaId, "Empresa");
  const { usuario } = await exigirAcessoEmpresa(request, empresaId);

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

  await registrarAuditoria({
    empresaId,
    autor: autor(usuario),
    acao: "integridade.verificada",
    descricao:
      problemas.length === 0
        ? `Verificação de integridade: ${doAparelho.size} marcação(ões) do aparelho, cadeia íntegra.`
        : `Verificação de integridade: ${problemas.length} problema(s) em ${doAparelho.size} marcação(ões) do aparelho.`,
    detalhes: { marcacoesAparelho: doAparelho.size, problemas: problemas.length },
  });

  return {
    marcacoesAparelho: doAparelho.size,
    marcacoesManuais: manuais.data().count,
    ultimoNsr,
    totalProblemas: problemas.length,
    problemas: problemas.slice(0, MAX_PROBLEMAS_NA_RESPOSTA),
  };
});

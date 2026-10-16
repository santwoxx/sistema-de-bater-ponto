import { HttpsError, onCall, type CallableRequest } from "firebase-functions/https";
import { incluirAbono, removerAbono } from "./abonos";
import { exigirUsuario } from "./acesso";
import { apagarMarcacao, desconsiderarMarcacao, incluirMarcacao } from "./ajustes";
import { removerCertificado, salvarCertificado } from "./certificado";
import { salvarConfiguracaoRep } from "./configuracaoRep";
import { ativarDispositivo, desativarDispositivo, salvarDispositivo } from "./dispositivos";
import { salvarEmpresa } from "./empresas";
import { associarEscala, removerEscala, salvarEscala } from "./escalas";
import { obterFoto } from "./fotos";
import { salvarFuncionario } from "./funcionarios";
import { criarSolicitacao, decidirSolicitacao } from "./solicitacoes";
import { salvarUsuario } from "./usuarios";
import { objeto } from "./validacao";

// Ações rápidas do painel numa função só. Cada ação continua com as próprias
// conferências (quem pode, o quê, auditoria); juntá-las serve ao desempenho:
// uma cópia aberta atende todas (sem uma partida a frio de segundos a cada
// ação diferente), com 1 vCPU e várias chamadas ao mesmo tempo, gastando bem
// menos da cota de CPU do Cloud Run do que uma função por ação. Ficam de fora
// as demoradas (fechamento, exportação, integridade) e as do aparelho.

const ACOES: Record<string, (request: CallableRequest) => Promise<unknown>> = {
  salvarEmpresa,
  salvarUsuario,
  salvarFuncionario,
  salvarEscala,
  removerEscala,
  associarEscala,
  ativarDispositivo,
  salvarDispositivo,
  desativarDispositivo,
  obterFoto,
  incluirMarcacao,
  desconsiderarMarcacao,
  apagarMarcacao,
  salvarConfiguracaoRep,
  salvarCertificado,
  removerCertificado,
  incluirAbono,
  removerAbono,
  criarSolicitacao,
  decidirSolicitacao,
};

export const painel = onCall({ cpu: 1, memory: "512MiB", maxInstances: 2, timeoutSeconds: 60 }, async (request) => {
  const { acao, dados } = objeto(request.data);
  // O painel chama ao abrir, para a cópia já estar pronta na primeira ação de verdade.
  if (acao === "aquecer") {
    await exigirUsuario(request);
    return { aquecido: true };
  }
  const executar = typeof acao === "string" && Object.hasOwn(ACOES, acao) ? ACOES[acao] : undefined;
  if (!executar) throw new HttpsError("invalid-argument", "Ação desconhecida.");
  return executar({ ...request, data: dados });
});

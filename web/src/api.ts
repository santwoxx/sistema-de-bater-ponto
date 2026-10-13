import { httpsCallable, type Functions } from 'firebase/functions'
import { functions } from './firebase'
import type { DiagnosticoCamera } from './hooks/useCamera'
import type { DocumentoEspelho } from './lib/espelho'
import type { DadosSemInternet, PacoteSelado, ResultadoEnvio } from './paginas/ponto/terminal/semInternet'
import type { TipoAbono } from './tipos'

// Chamadas às Cloud Functions, com tipos. O segundo parâmetro permite usar
// a conexão temporária do gestor no aparelho de ponto.

function funcao<Entrada, Saida>(nome: string, timeout?: number) {
  return async (dados: Entrada, conexao: Functions = functions): Promise<Saida> => {
    const resultado = await httpsCallable<Entrada, Saida>(conexao, nome, timeout ? { timeout } : undefined)(dados)
    return resultado.data
  }
}

/**
 * Ação rápida do painel: todas passam pela mesma função do servidor ("painel"),
 * que fica aberta depois da primeira chamada (ver functions/src/painel.ts).
 */
function acaoDoPainel<Entrada, Saida>(acao: string) {
  const painel = funcao<{ acao: string; dados?: Entrada }, Saida>('painel')
  return (dados: Entrada, conexao?: Functions) => painel({ acao, dados }, conexao)
}

export interface DadosEmpresa {
  id?: string
  nome: string
  cnpj: string
  fusoHorario: string
  intervaloMinimoMinutos: number
  toleranciaMinutos: number
  inicioControle: string | null
  ativo: boolean
}

export interface DadosUsuario {
  uid?: string
  nome: string
  email: string
  senha?: string
  papel: 'admin' | 'gestor'
  empresas: string[]
  ativo: boolean
}

export interface DadosFuncionario {
  empresaId: string
  id?: string
  nome: string
  cpf: string
  matricula: string
  cargo: string
  admissao: string | null
  jornada: number[]
  ativo: boolean
  pin?: string
}

export interface ComprovantePonto {
  registroId: string
  nsr: number
  dataHora: number
  dataLocal: string
  horaLocal: string
  funcionarioNome: string
  ordinal: number
  tipo: 'entrada' | 'saida'
  empresaNome: string
  codigoVerificacao: string
}

export type Sincronizacao =
  | { ativo: false; agora: number }
  | {
      ativo: true
      agora: number
      /** funcionario: dono, se for o celular pessoal de alguém (só ele bate ponto, digitando só o PIN). */
      dispositivo: { id: string; nome: string; funcionario?: { nome: string } | null }
      empresa: { id: string; nome: string; fusoHorario: string; ativo: boolean }
      /** Para guardar batidas se a internet cair (ver paginas/ponto/terminal/semInternet.ts). */
      semInternet?: DadosSemInternet | null
    }

export const api = {
  configurarPrimeiroAdmin: funcao<{ nome: string; email: string; senha?: string; codigo: string }, { ok: true }>('configurarPrimeiroAdmin'),
  // Abre a função do painel antes da primeira ação (sem espera de partida a frio).
  aquecerPainel: () => funcao<{ acao: 'aquecer' }, { aquecido: true }>('painel')({ acao: 'aquecer' }),
  salvarEmpresa: acaoDoPainel<DadosEmpresa, { id: string }>('salvarEmpresa'),
  salvarUsuario: acaoDoPainel<DadosUsuario, { uid: string }>('salvarUsuario'),
  salvarFuncionario: acaoDoPainel<DadosFuncionario, { id: string }>('salvarFuncionario'),
  ativarDispositivo: acaoDoPainel<{ empresaId: string; nome: string; funcionarioId?: string | null }, { email: string; senha: string; empresaNome: string }>(
    'ativarDispositivo',
  ),
  desativarDispositivo: acaoDoPainel<{ empresaId: string; dispositivoId: string }, { ok: true }>('desativarDispositivo'),
  // Uso do aparelho: celular pessoal de um funcionário (funcionarioId) ou aparelho da loja (null).
  salvarDispositivo: acaoDoPainel<{ empresaId: string; dispositivoId: string; funcionarioId: string | null }, { ok: true }>('salvarDispositivo'),
  // O aparelho informa o estado da câmera, que o gestor vê em "Aparelhos de ponto".
  sincronizarDispositivo: funcao<{ camera?: DiagnosticoCamera }, Sincronizacao>('sincronizarDispositivo', 15_000),
  // Aparelho da loja: CPF + PIN de 4 números. Celular pessoal: só o PIN (o aparelho já é do funcionário).
  registrarPonto: funcao<{ idRequisicao: string; cpf?: string; pin: string; foto: string; miniatura: string }, ComprovantePonto>(
    'registrarPonto',
    25_000,
  ),
  // O aparelho chama quando alguém começa a digitar: a função já está aberta quando a foto chega.
  aquecerPonto: () => funcao<{ aquecer: true }, { aquecido: true }>('registrarPonto', 15_000)({ aquecer: true }),
  // Batida feita sem internet, guardada cifrada no aparelho e enviada quando a conexão volta.
  registrarPontoGuardado: funcao<{ pacote: PacoteSelado }, ResultadoEnvio>('registrarPontoGuardado', 60_000),
  // Foto completa de uma marcação, conferida com o hash gravado no registro.
  obterFoto: acaoDoPainel<{ empresaId: string; registroId: string }, { foto: string; confere: boolean }>('obterFoto'),
  incluirMarcacao: acaoDoPainel<
    { empresaId: string; funcionarioId: string; data: string; hora: string; justificativa: string },
    { id: string }
  >('incluirMarcacao'),
  desconsiderarMarcacao: acaoDoPainel<
    { empresaId: string; registroId: string; motivo?: string; restaurar?: boolean },
    { ok: true }
  >('desconsiderarMarcacao'),
  incluirAbono: acaoDoPainel<
    {
      empresaId: string
      funcionarioId: string | null
      tipo: TipoAbono
      descricao: string
      de: string
      ate: string
      minutos: number | null
    },
    { criados: number }
  >('incluirAbono'),
  removerAbono: acaoDoPainel<{ empresaId: string; abonoId: string }, { ok: true }>('removerAbono'),
  criarSolicitacao: acaoDoPainel<
    { empresaId: string; funcionarioId: string; data: string; hora: string; motivo: string; aprovarAgora: boolean },
    { id: string; registroId: string | null }
  >('criarSolicitacao'),
  decidirSolicitacao: acaoDoPainel<
    { empresaId: string; solicitacaoId: string; aprovar: boolean; motivoRecusa?: string },
    { ok: true; registroId: string | null }
  >('decidirSolicitacao'),
  fecharEspelhos: funcao<
    { empresaId: string; mes: string; funcionarioIds?: string[]; motivoReabertura?: string },
    { resultados: Array<{ funcionarioId: string; nome: string; resultado: ResultadoFechamento }> }
  >('fecharEspelhos', 120_000),
  exportarDados: funcao<DadosExportacao, ResultadoExportacao>('exportarDados', 300_000),
  verificarIntegridade: funcao<{ empresaId: string }, ResultadoIntegridade>('verificarIntegridade', 300_000),
}

export interface ResultadoIntegridade {
  marcacoesAparelho: number
  marcacoesManuais: number
  ultimoNsr: number
  totalProblemas: number
  problemas: Array<{ nsr: number | null; registroId: string | null; descricao: string }>
}

export type ResultadoFechamento = 'fechado' | 'atualizado' | 'sem-alteracoes' | 'exige-motivo'

export type TipoExportacao = 'marcacoes' | 'espelho-diario' | 'resumo' | 'espelhos'

export interface DadosExportacao {
  empresaId: string
  tipo: TipoExportacao
  de: string
  ate: string
  /** null = todos os funcionários. */
  funcionarioIds: string[] | null
  incluirDesconsideradas: boolean
  origem: 'todas' | 'dispositivo' | 'manual'
}

export interface EspelhoParaImpressao {
  mes: string
  funcionario: { id: string; nome: string; cpf: string; matricula: string; cargo: string; admissao: string | null }
  documento: DocumentoEspelho
  /** Mês fechado: a versão congelada (a que vai para a assinatura em papel). */
  fechamento: { versao: number; fechadoEm: number | null; fechadoPor: string } | null
}

export interface ResultadoExportacao {
  tipo: TipoExportacao
  nomeArquivo: string
  quantidade: number
  empresa: { nome: string; cnpj: string }
  linhas?: Array<Array<string | number | null>>
  espelhos?: EspelhoParaImpressao[]
}

import { httpsCallable, type Functions } from 'firebase/functions'
import { functions } from './firebase'
import type { DocumentoEspelho } from './lib/espelho'
import type { TipoAbono } from './tipos'

// Chamadas às Cloud Functions, com tipos. O segundo parâmetro permite usar
// a conexão temporária do gestor no aparelho de ponto.

function funcao<Entrada, Saida>(nome: string, timeout?: number) {
  return async (dados: Entrada, conexao: Functions = functions): Promise<Saida> => {
    const resultado = await httpsCallable<Entrada, Saida>(conexao, nome, timeout ? { timeout } : undefined)(dados)
    return resultado.data
  }
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
      dispositivo: { id: string; nome: string }
      empresa: { id: string; nome: string; fusoHorario: string; ativo: boolean }
    }

export const api = {
  configurarPrimeiroAdmin: funcao<{ nome: string; email: string; senha: string; codigo: string }, { ok: true }>('configurarPrimeiroAdmin'),
  salvarEmpresa: funcao<DadosEmpresa, { id: string }>('salvarEmpresa'),
  salvarUsuario: funcao<DadosUsuario, { uid: string }>('salvarUsuario'),
  salvarFuncionario: funcao<DadosFuncionario, { id: string }>('salvarFuncionario'),
  ativarDispositivo: funcao<{ empresaId: string; nome: string }, { email: string; senha: string; empresaNome: string }>(
    'ativarDispositivo',
  ),
  desativarDispositivo: funcao<{ empresaId: string; dispositivoId: string }, { ok: true }>('desativarDispositivo'),
  sincronizarDispositivo: funcao<Record<string, never>, Sincronizacao>('sincronizarDispositivo', 15_000),
  registrarPonto: funcao<
    { idRequisicao: string; matricula: string; pin: string; foto: string; miniatura: string },
    ComprovantePonto
  >('registrarPonto', 25_000),
  // O funcionário cria (no primeiro uso) ou troca o próprio PIN, no aparelho.
  definirPin: funcao<
    { matricula: string; pin: string; novoPin: string; miniatura: string | null },
    { funcionarioNome: string }
  >('definirPin', 25_000),
  // Foto completa de uma marcação, conferida com o hash gravado no registro.
  obterFoto: funcao<{ empresaId: string; registroId: string }, { foto: string; confere: boolean }>('obterFoto', 30_000),
  incluirMarcacao: funcao<
    { empresaId: string; funcionarioId: string; data: string; hora: string; justificativa: string },
    { id: string }
  >('incluirMarcacao'),
  desconsiderarMarcacao: funcao<
    { empresaId: string; registroId: string; motivo?: string; restaurar?: boolean },
    { ok: true }
  >('desconsiderarMarcacao'),
  incluirAbono: funcao<
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
  removerAbono: funcao<{ empresaId: string; abonoId: string }, { ok: true }>('removerAbono'),
  // Feita no aparelho de ponto, identificando o funcionário pela matrícula + PIN.
  solicitarMarcacao: funcao<
    { matricula: string; pin: string; data: string; hora: string; motivo: string; miniatura: string | null },
    { id: string; funcionarioNome: string; data: string; hora: string }
  >('solicitarMarcacao', 25_000),
  criarSolicitacao: funcao<
    { empresaId: string; funcionarioId: string; data: string; hora: string; motivo: string; aprovarAgora: boolean },
    { id: string; registroId: string | null }
  >('criarSolicitacao'),
  decidirSolicitacao: funcao<
    { empresaId: string; solicitacaoId: string; aprovar: boolean; motivoRecusa?: string },
    { ok: true; registroId: string | null }
  >('decidirSolicitacao'),
  fecharEspelhos: funcao<
    { empresaId: string; mes: string; funcionarioIds?: string[]; motivoReabertura?: string },
    { resultados: Array<{ funcionarioId: string; nome: string; resultado: ResultadoFechamento }> }
  >('fecharEspelhos', 120_000),
  // Feitas no aparelho de ponto, identificando o funcionário pela matrícula + PIN.
  consultarEspelhosPendentes: funcao<{ matricula: string; pin: string }, { funcionarioNome: string; espelhos: EspelhoParaAssinar[] }>(
    'consultarEspelhosPendentes',
    25_000,
  ),
  assinarEspelho: funcao<
    {
      matricula: string
      pin: string
      espelhoId: string
      hash: string
      concordo: boolean
      motivo?: string
      miniatura: string | null
    },
    { status: 'assinado' | 'contestado'; mes: string; codigo: string }
  >('assinarEspelho', 25_000),
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
  fechamento: {
    status: 'aguardando' | 'assinado' | 'contestado'
    versao: number
    fechadoEm: number | null
    fechadoPor: string
    assinatura: { em: number | null; codigo: string; dispositivoNome: string } | null
    contestacao: { em: number | null; motivo: string } | null
  } | null
}

export interface ResultadoExportacao {
  tipo: TipoExportacao
  nomeArquivo: string
  quantidade: number
  empresa: { nome: string; cnpj: string }
  linhas?: Array<Array<string | number | null>>
  espelhos?: EspelhoParaImpressao[]
}

export interface EspelhoParaAssinar {
  id: string
  mes: string
  hash: string
  empresaNome: string
  funcionario: { nome: string; matricula: string; cargo: string }
  documento: DocumentoEspelho
}

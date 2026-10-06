import { httpsCallable, type Functions } from 'firebase/functions'
import { functions } from './firebase'
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
  configurarPrimeiroAdmin: funcao<{ nome: string; email: string; senha: string }, { ok: true }>('configurarPrimeiroAdmin'),
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
}

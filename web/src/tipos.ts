import type { DocumentSnapshot, Timestamp } from 'firebase/firestore'

export type Papel = 'admin' | 'gestor'

export interface Autor {
  uid: string
  nome: string
}

export interface Perfil {
  uid: string
  nome: string
  email: string
  papel: Papel
  empresas: string[]
  ativo: boolean
}

export interface Empresa {
  id: string
  nome: string
  cnpj: string
  fusoHorario: string
  ativo: boolean
  intervaloMinimoMinutos: number
  toleranciaMinutos: number
  /** Antes desta data (AAAA-MM-DD), dias sem marcação não contam como falta. */
  inicioControle: string | null
}

export interface Funcionario {
  id: string
  nome: string
  cpf: string
  matricula: string
  cargo: string
  admissao: string | null
  /** Minutos previstos por dia da semana: [domingo, segunda, ..., sábado]. */
  jornada: number[]
  ativo: boolean
  pinDefinido: boolean
}

export interface Desconsideracao {
  motivo: string
  por: Autor
  em: Timestamp | null
}

export interface Registro {
  id: string
  funcionarioId: string
  funcionarioNome: string
  funcionarioMatricula: string
  funcionarioCpf: string
  dataHora: Timestamp
  dataLocal: string
  horaLocal: string
  origem: 'dispositivo' | 'manual'
  dispositivoId?: string
  dispositivoNome?: string
  nsr?: number
  hash?: string
  hashAnterior?: string
  fotoPath?: string
  fotoSha256?: string
  miniatura?: string
  justificativa?: string
  incluidoPor?: Autor
  desconsiderado: Desconsideracao | null
}

export interface Dispositivo {
  id: string
  nome: string
  ativo: boolean
  criadoEm: Timestamp | null
  criadoPor?: Autor
  ultimoSinalEm: Timestamp | null
  ultimoRegistroEm: Timestamp | null
  agenteUsuario?: string
  desativadoEm?: Timestamp | null
  desativadoPor?: Autor
}

export type TipoAbono = 'feriado' | 'atestado' | 'ferias' | 'folga' | 'outro'

export const ROTULOS_ABONO: Record<TipoAbono, string> = {
  feriado: 'Feriado',
  atestado: 'Atestado',
  ferias: 'Férias',
  folga: 'Folga',
  outro: 'Abono',
}

export interface Abono {
  id: string
  data: string
  /** null = vale para todos os funcionários da empresa (ex.: feriado). */
  funcionarioId: string | null
  funcionarioNome: string | null
  tipo: TipoAbono
  descricao: string
  /** null = dia inteiro; número = minutos abonados no dia. */
  minutos: number | null
  criadoPor?: Autor
  criadoEm: Timestamp | null
}

export interface EntradaAuditoria {
  id: string
  acao: string
  descricao: string
  autor: Autor
  em: Timestamp | null
  detalhes: Record<string, unknown>
}

export const JORNADA_PADRAO = [0, 480, 480, 480, 480, 480, 240]

export function paraEmpresa(snap: DocumentSnapshot): Empresa {
  const d = snap.data() ?? {}
  return {
    id: snap.id,
    nome: d.nome ?? '',
    cnpj: d.cnpj ?? '',
    fusoHorario: d.fusoHorario ?? 'America/Sao_Paulo',
    ativo: d.ativo !== false,
    intervaloMinimoMinutos: d.intervaloMinimoMinutos ?? 2,
    toleranciaMinutos: d.toleranciaMinutos ?? 10,
    inicioControle: typeof d.inicioControle === 'string' ? d.inicioControle : null,
  }
}

export function paraFuncionario(snap: DocumentSnapshot): Funcionario {
  const d = snap.data() ?? {}
  return {
    id: snap.id,
    nome: d.nome ?? '',
    cpf: d.cpf ?? '',
    matricula: d.matricula ?? '',
    cargo: d.cargo ?? '',
    admissao: d.admissao ?? null,
    jornada: Array.isArray(d.jornada) && d.jornada.length === 7 ? d.jornada : JORNADA_PADRAO,
    ativo: d.ativo !== false,
    pinDefinido: d.pinDefinido === true,
  }
}

export function paraRegistro(snap: DocumentSnapshot): Registro {
  return { id: snap.id, desconsiderado: null, ...snap.data() } as Registro
}

export function paraDispositivo(snap: DocumentSnapshot): Dispositivo {
  const d = snap.data() ?? {}
  return {
    id: snap.id,
    nome: d.nome ?? '',
    ativo: d.ativo === true,
    criadoEm: d.criadoEm ?? null,
    criadoPor: d.criadoPor,
    ultimoSinalEm: d.ultimoSinalEm ?? null,
    ultimoRegistroEm: d.ultimoRegistroEm ?? null,
    agenteUsuario: d.agenteUsuario,
    desativadoEm: d.desativadoEm ?? null,
    desativadoPor: d.desativadoPor,
  }
}

export function paraAbono(snap: DocumentSnapshot): Abono {
  const d = snap.data() ?? {}
  return {
    id: snap.id,
    data: d.data ?? '',
    funcionarioId: d.funcionarioId ?? null,
    funcionarioNome: d.funcionarioNome ?? null,
    tipo: d.tipo in ROTULOS_ABONO ? d.tipo : 'outro',
    descricao: d.descricao ?? '',
    minutos: typeof d.minutos === 'number' ? d.minutos : null,
    criadoPor: d.criadoPor,
    criadoEm: d.criadoEm ?? null,
  }
}

export function paraAuditoria(snap: DocumentSnapshot): EntradaAuditoria {
  const d = snap.data() ?? {}
  return {
    id: snap.id,
    acao: d.acao ?? '',
    descricao: d.descricao ?? '',
    autor: d.autor ?? { uid: '', nome: '' },
    em: d.em ?? null,
    detalhes: d.detalhes ?? {},
  }
}

export function ordenarPorNome<T extends { nome: string }>(itens: T[]): T[] {
  return [...itens].sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'))
}

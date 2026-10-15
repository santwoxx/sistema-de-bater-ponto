import type { DocumentSnapshot, Timestamp } from 'firebase/firestore'
import type { DocumentoEspelho } from './lib/espelho'

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
  /** CPF (só números): vai no AFD como responsável pelas alterações no REP. */
  cpf?: string
}

export interface Empresa {
  id: string
  nome: string
  cnpj: string
  /** Local da prestação do serviço ou endereço do estabelecimento (comprovante e AFD). */
  endereco: string
  fusoHorario: string
  ativo: boolean
  intervaloMinimoMinutos: number
  toleranciaMinutos: number
  /** Antes desta data (AAAA-MM-DD), dias sem marcação não contam como falta. */
  inicioControle: string | null
  /** Última verificação da cadeia de hashes (manual ou automática, semanal). */
  integridade: Integridade | null
}

export interface Integridade {
  verificadaEm: Timestamp | null
  automatica: boolean
  marcacoes: number
  problemas: number
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
  /** Horário contratual por dia da semana ("08:00-12:00 13:00-17:00"; "" = folga). null = cadastrado antes de existir. */
  horario: string[] | null
  ativo: boolean
  /** Tem o PIN de 4 números com que bate o ponto (quem tinha o PIN antigo precisa de um novo). */
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
  /** Código hash SHA-256 da marcação (Portaria 671: AFD e comprovante). Falta nas marcações de antes. */
  rep?: { hash: string; hashAnterior: string }
  /** Apagada pelo administrador: não aparece em nenhuma tela (fica só para a cadeia de hashes). */
  apagado?: Desconsideracao
  /** Batida feita sem internet no aparelho e enviada depois. */
  semInternet?: {
    recebidoEm: Timestamp
    /** O horário merece conferência (relógio do aparelho mudou, aparelho reiniciado...). */
    conferir: boolean
    motivo: string | null
    horarioRelogio: Timestamp
    horarioDecorrido: Timestamp | null
    ultimaConexaoEm: Timestamp
  }
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
  /** Celular pessoal: só este funcionário bate ponto no aparelho. null = aparelho da loja. */
  funcionarioId: string | null
  funcionarioNome: string | null
  /** Outras empresas que o aparelho da loja atende, além da dele (o PIN diz de quem é a batida). */
  outrasEmpresas: string[]
  /** Estado da câmera informado pelo aparelho na última sincronização. */
  camera?: {
    estado: 'iniciando' | 'pronta' | 'toque' | 'erro'
    codigo: string | null
    detalhe: string | null
    permissao: string
    resolucao: string | null
    atualizadaEm: Timestamp | null
  }
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

export type StatusSolicitacao = 'pendente' | 'aprovada' | 'recusada'

/** Pedido de inclusão de uma marcação esquecida (pelo funcionário ou pelo gestor). */
export interface Solicitacao {
  id: string
  funcionarioId: string
  funcionarioNome: string
  funcionarioMatricula: string
  data: string
  hora: string
  motivo: string
  /** Gestor que registrou a solicitação no painel. */
  solicitadoPor: Autor
  status: StatusSolicitacao
  criadoEm: Timestamp | null
  decididoPor?: Autor
  decididoEm?: Timestamp | null
  motivoRecusa?: string
  registroId?: string
}

/** Espelho de um mês fechado: versão congelada, impressa para o funcionário assinar em papel. */
export interface EspelhoFechado {
  id: string
  mes: string
  funcionarioId: string
  hash: string
  versao: number
  empresa: { id: string; nome: string; cnpj: string }
  funcionario: { id: string; nome: string; cpf: string; matricula: string; cargo: string; admissao: string | null }
  documento: DocumentoEspelho
  fechadoPor: Autor
  fechadoEm: Timestamp | null
  /** Versão refeita depois do fechamento: o motivo da reabertura. */
  reabertura: { motivo: string } | null
}

export function paraEspelhoFechado(snap: DocumentSnapshot): EspelhoFechado {
  const d = snap.data() ?? {}
  return {
    id: snap.id,
    mes: d.mes ?? '',
    funcionarioId: d.funcionarioId ?? '',
    hash: d.hash ?? '',
    versao: d.versao ?? 1,
    empresa: d.empresa ?? { id: '', nome: '', cnpj: '' },
    funcionario: d.funcionario ?? { id: '', nome: '', cpf: '', matricula: '', cargo: '', admissao: null },
    documento: d.documento,
    fechadoPor: d.fechadoPor ?? { uid: '', nome: '' },
    fechadoEm: d.fechadoEm ?? null,
    reabertura: typeof d.reabertura?.motivo === 'string' ? { motivo: d.reabertura.motivo } : null,
  }
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
    endereco: d.endereco ?? '',
    fusoHorario: d.fusoHorario ?? 'America/Sao_Paulo',
    ativo: d.ativo !== false,
    intervaloMinimoMinutos: d.intervaloMinimoMinutos ?? 2,
    toleranciaMinutos: d.toleranciaMinutos ?? 10,
    inicioControle: typeof d.inicioControle === 'string' ? d.inicioControle : null,
    integridade: d.integridade
      ? {
          verificadaEm: d.integridade.verificadaEm ?? null,
          automatica: d.integridade.automatica === true,
          marcacoes: Number(d.integridade.marcacoes ?? 0),
          problemas: Number(d.integridade.problemas ?? 0),
        }
      : null,
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
    horario: Array.isArray(d.horario) && d.horario.length === 7 ? d.horario : null,
    ativo: d.ativo !== false,
    pinDefinido: d.pinAtivo === true,
  }
}

export function paraRegistro(snap: DocumentSnapshot): Registro {
  return { id: snap.id, desconsiderado: null, ...snap.data() } as Registro
}

/** Para as listas: marcação apagada pelo administrador não aparece em nenhuma tela. */
export function naoApagada(registro: Registro): boolean {
  return !registro.apagado
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
    funcionarioId: typeof d.funcionarioId === 'string' ? d.funcionarioId : null,
    funcionarioNome: typeof d.funcionarioNome === 'string' ? d.funcionarioNome : null,
    outrasEmpresas: Array.isArray(d.empresas) ? d.empresas.filter((id: unknown) => typeof id === 'string' && id !== snap.ref.parent.parent?.id) : [],
    camera: d.camera,
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

export function paraSolicitacao(snap: DocumentSnapshot): Solicitacao {
  const d = snap.data() ?? {}
  return {
    id: snap.id,
    funcionarioId: d.funcionarioId ?? '',
    funcionarioNome: d.funcionarioNome ?? '',
    funcionarioMatricula: d.funcionarioMatricula ?? '',
    data: d.data ?? '',
    hora: d.hora ?? '',
    motivo: d.motivo ?? '',
    solicitadoPor: d.solicitadoPor ?? { uid: '', nome: '' },
    status: d.status === 'aprovada' || d.status === 'recusada' ? d.status : 'pendente',
    criadoEm: d.criadoEm ?? null,
    decididoPor: d.decididoPor,
    decididoEm: d.decididoEm ?? null,
    motivoRecusa: d.motivoRecusa,
    registroId: d.registroId,
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

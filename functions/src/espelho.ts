// Espelho de ponto: para cada dia do mês, as marcações válidas em pares
// (entrada → saída), as horas trabalhadas, as previstas e o saldo.
//
// Este arquivo é a fonte única do cálculo: o servidor o usa para gerar o
// espelho oficial do fechamento (que o funcionário assina) e o painel o
// importa para mostrar o espelho ao vivo. Não pode importar nada do Firebase.

export interface MarcacaoBruta {
  id: string
  dataLocal: string
  horaLocal: string
  origem: 'dispositivo' | 'manual'
  desconsiderado: unknown
}

export interface MarcacaoDia {
  id: string
  hora: string
  minutos: number
  tipo: 'entrada' | 'saida'
  manual: boolean
}

/** Ausência justificada (feriado, atestado, férias...). minutos null = dia inteiro. */
export interface AbonoBruto {
  id: string
  data: string
  tipo: string
  descricao: string
  minutos: number | null
}

export interface DiaEspelho {
  data: string
  diaSemana: number
  marcacoes: MarcacaoDia[]
  abonos: AbonoBruto[]
  previstoMin: number
  trabalhadoMin: number
  /** null quando o dia ainda não terminou (hoje ou futuro). */
  saldoMin: number | null
  incompleto: boolean
  falta: boolean
  temManual: boolean
  situacao: 'normal' | 'hoje' | 'futuro' | 'antes-admissao' | 'antes-inicio'
}

export interface ResumoEspelho {
  dias: DiaEspelho[]
  totalPrevistoMin: number
  totalTrabalhadoMin: number
  saldoMin: number
  diasTrabalhados: number
  faltas: number
  diasIncompletos: number
}

export const ROTULOS_ABONO: Record<string, string> = {
  feriado: 'Feriado',
  atestado: 'Atestado',
  ferias: 'Férias',
  folga: 'Folga',
  outro: 'Abono',
}

function paraMinutos(hora: string): number {
  const [h, m] = hora.split(':').map(Number)
  return h * 60 + m
}

function diaSemana(dataISO: string): number {
  const [ano, mes, dia] = dataISO.split('-').map(Number)
  return new Date(Date.UTC(ano, mes - 1, dia)).getUTCDay()
}

function diasDoMes(mes: string): string[] {
  const [ano, numeroMes] = mes.split('-').map(Number)
  const total = new Date(Date.UTC(ano, numeroMes, 0)).getUTCDate()
  return Array.from({ length: total }, (_, i) => `${mes}-${String(i + 1).padStart(2, '0')}`)
}

function hhmm(minutos: number): string {
  const absoluto = Math.abs(Math.round(minutos))
  return `${String(Math.floor(absoluto / 60)).padStart(2, '0')}:${String(absoluto % 60).padStart(2, '0')}`
}

export function rotuloTipo(tipo: 'entrada' | 'saida'): string {
  return tipo === 'entrada' ? 'Entrada' : 'Saída'
}

/** Classifica marcações válidas de um dia (já ordenadas): 1ª entrada, 2ª saída, 3ª entrada... */
export function classificar<T>(marcacoesOrdenadas: T[]): Array<T & { tipo: 'entrada' | 'saida' }> {
  return marcacoesOrdenadas.map((m, i) => ({ ...m, tipo: i % 2 === 0 ? 'entrada' : 'saida' }))
}

export function rotuloAbono(abono: Pick<AbonoBruto, 'tipo' | 'descricao' | 'minutos'>): string {
  const tipo = ROTULOS_ABONO[abono.tipo] ?? 'Abono'
  return `${tipo}${abono.minutos === null ? '' : ` ${hhmm(abono.minutos)}`}: ${abono.descricao}`
}

/** Ocorrências de um dia em texto (falta, marcação ímpar, abonos...). */
export function ocorrenciasDoDia(dia: DiaEspelho, comAbonos = true): string[] {
  const lista = comAbonos ? dia.abonos.map(rotuloAbono) : []
  if (dia.falta) lista.push('Falta')
  if (dia.incompleto) lista.push('Marcação ímpar')
  if (dia.temManual) lista.push('Ajuste manual')
  if (dia.situacao === 'hoje') lista.push('Em andamento')
  if (dia.situacao === 'antes-admissao') lista.push('Antes da admissão')
  if (dia.situacao === 'antes-inicio') lista.push('Antes do início do controle')
  return lista
}

export function calcularEspelho(params: {
  mes: string
  registros: MarcacaoBruta[]
  jornada: number[]
  hoje: string
  admissao?: string | null
  /** Início do uso do ponto na empresa: antes dele, dia sem marcação não é falta. */
  inicioControle?: string | null
  /** Abonos que valem para este funcionário (os dele e os coletivos). */
  abonos?: AbonoBruto[]
  toleranciaMin: number
}): ResumoEspelho {
  const { mes, registros, jornada, hoje, admissao, inicioControle, abonos = [], toleranciaMin } = params

  const porDia = new Map<string, MarcacaoBruta[]>()
  for (const r of registros) {
    if (r.desconsiderado || !r.dataLocal.startsWith(mes)) continue
    const lista = porDia.get(r.dataLocal) ?? []
    lista.push(r)
    porDia.set(r.dataLocal, lista)
  }
  const abonosPorDia = new Map<string, AbonoBruto[]>()
  for (const a of abonos) abonosPorDia.set(a.data, [...(abonosPorDia.get(a.data) ?? []), a])

  const dias = diasDoMes(mes).map<DiaEspelho>((data) => {
    const ds = diaSemana(data)
    const brutas = (porDia.get(data) ?? []).sort((a, b) => a.horaLocal.localeCompare(b.horaLocal))
    const marcacoes = classificar(
      brutas.map((r) => ({
        id: r.id,
        hora: r.horaLocal.slice(0, 5),
        minutos: paraMinutos(r.horaLocal),
        manual: r.origem === 'manual',
      })),
    )

    let trabalhadoMin = 0
    for (let i = 0; i + 1 < marcacoes.length; i += 2) {
      trabalhadoMin += Math.max(0, marcacoes[i + 1].minutos - marcacoes[i].minutos)
    }

    const situacao: DiaEspelho['situacao'] =
      admissao && data < admissao
        ? 'antes-admissao'
        : data > hoje
          ? 'futuro'
          : data === hoje
            ? 'hoje'
            : inicioControle && data < inicioControle && marcacoes.length === 0
              ? 'antes-inicio'
              : 'normal'
    // Abono de dia inteiro zera a jornada prevista; abono parcial abate só as horas abonadas.
    const abonosDoDia = (abonosPorDia.get(data) ?? []).sort((a, b) => a.id.localeCompare(b.id))
    const jornadaDoDia = situacao === 'antes-admissao' || situacao === 'antes-inicio' ? 0 : (jornada[ds] ?? 0)
    const previstoMin = abonosDoDia.some((a) => a.minutos === null)
      ? 0
      : Math.max(0, jornadaDoDia - abonosDoDia.reduce((s, a) => s + (a.minutos ?? 0), 0))
    const incompleto = marcacoes.length % 2 === 1

    let saldoMin: number | null = null
    if (situacao === 'normal' || situacao === 'antes-admissao') {
      const bruto = trabalhadoMin - previstoMin
      saldoMin = Math.abs(bruto) <= toleranciaMin ? 0 : bruto
    }

    return {
      data,
      diaSemana: ds,
      marcacoes,
      abonos: abonosDoDia,
      previstoMin,
      trabalhadoMin,
      saldoMin,
      incompleto: incompleto && situacao !== 'hoje',
      falta: situacao === 'normal' && previstoMin > 0 && marcacoes.length === 0,
      temManual: marcacoes.some((m) => m.manual),
      situacao,
    }
  })

  const fechados = dias.filter((d) => d.saldoMin !== null)
  return {
    dias,
    totalPrevistoMin: fechados.reduce((s, d) => s + d.previstoMin, 0),
    totalTrabalhadoMin: dias.reduce((s, d) => s + d.trabalhadoMin, 0),
    saldoMin: fechados.reduce((s, d) => s + (d.saldoMin ?? 0), 0),
    diasTrabalhados: dias.filter((d) => d.marcacoes.length > 0).length,
    faltas: dias.filter((d) => d.falta).length,
    diasIncompletos: dias.filter((d) => d.incompleto).length,
  }
}

// --- Documento do espelho (versão congelada no fechamento do mês) --------

export interface DiaDocumento {
  data: string
  marcacoes: Array<{ hora: string; tipo: 'entrada' | 'saida'; manual: boolean }>
  previstoMin: number
  trabalhadoMin: number
  saldoMin: number | null
  ocorrencias: string[]
}

export interface DocumentoEspelho {
  dias: DiaDocumento[]
  totais: {
    previstoMin: number
    trabalhadoMin: number
    saldoMin: number
    diasTrabalhados: number
    faltas: number
    diasIncompletos: number
  }
  toleranciaMin: number
}

/**
 * Converte o cálculo no documento que é guardado no fechamento e assinado.
 * A ordem dos campos é fixa: o mesmo espelho gera sempre o mesmo texto (e hash).
 */
export function documentoDoEspelho(resumo: ResumoEspelho, toleranciaMin: number): DocumentoEspelho {
  return {
    dias: resumo.dias.map((d) => ({
      data: d.data,
      marcacoes: d.marcacoes.map((m) => ({ hora: m.hora, tipo: m.tipo, manual: m.manual })),
      previstoMin: d.previstoMin,
      trabalhadoMin: d.trabalhadoMin,
      saldoMin: d.saldoMin,
      ocorrencias: ocorrenciasDoDia(d),
    })),
    totais: {
      previstoMin: resumo.totalPrevistoMin,
      trabalhadoMin: resumo.totalTrabalhadoMin,
      saldoMin: resumo.saldoMin,
      diasTrabalhados: resumo.diasTrabalhados,
      faltas: resumo.faltas,
      diasIncompletos: resumo.diasIncompletos,
    },
    toleranciaMin,
  }
}

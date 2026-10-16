// Horário contratual do funcionário (Portaria 671: espelho, art. 84, e AEJ,
// registro do tipo 04): para cada dia da semana (0 = domingo), os pares de
// entrada e saída, como "08:00-12:00 13:00-17:00"; texto vazio é folga. A
// jornada prevista do dia é a soma dos pares. Fonte única: servidor e painel
// usam este arquivo (o painel o reexporta em web/src/lib/horario.ts).

export interface ParHorario {
  entrada: string
  saida: string
}

export const MAX_PARES_POR_DIA = 3
export const DIAS_DA_SEMANA_CURTOS = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb']

const HORA = /^([01]\d|2[0-3]):[0-5]\d$/

const emMinutos = (hora: string) => Number(hora.slice(0, 2)) * 60 + Number(hora.slice(3, 5))

/** Pares do dia, ou null se o texto não estiver no formato "HH:MM-HH:MM HH:MM-HH:MM". */
export function paresDoDia(texto: string): ParHorario[] | null {
  const limpo = texto.trim()
  if (limpo === '') return []
  const pares = limpo.split(/\s+/).map((par) => {
    const [entrada, saida, ...resto] = par.split('-')
    return resto.length === 0 && HORA.test(entrada ?? '') && HORA.test(saida ?? '') ? { entrada, saida } : null
  })
  return pares.every((par): par is ParHorario => par !== null) ? pares : null
}

/** Minutos de um par (saída antes da entrada: o turno passa da meia-noite). */
export function minutosDoPar(par: ParHorario): number {
  const diferenca = emMinutos(par.saida) - emMinutos(par.entrada)
  return diferenca > 0 ? diferenca : diferenca + 24 * 60
}

/** Jornada prevista de cada dia da semana, em minutos. */
export function jornadaDoHorario(horario: string[]): number[] {
  return horario.map((dia) => (paresDoDia(dia) ?? []).reduce((total, par) => total + minutosDoPar(par), 0))
}

/** O que está errado no horário (para avisar antes de salvar), ou null. */
export function problemaNoHorario(horario: string[]): string | null {
  if (horario.length !== 7) return 'Horário contratual: informe os 7 dias da semana.'
  for (const [dia, texto] of horario.entries()) {
    const pares = paresDoDia(texto)
    const nome = DIAS_DA_SEMANA_CURTOS[dia]
    if (!pares) return `Horário de ${nome}: use "HH:MM-HH:MM", com um espaço entre os pares (ex.: 08:00-12:00 13:00-17:00).`
    if (pares.length > MAX_PARES_POR_DIA) return `Horário de ${nome}: no máximo ${MAX_PARES_POR_DIA} pares de entrada e saída.`
    if (pares.some((par) => par.entrada === par.saida)) return `Horário de ${nome}: a entrada e a saída não podem ser iguais.`
    if (pares.reduce((total, par) => total + minutosDoPar(par), 0) > 24 * 60) return `Horário de ${nome}: passa de 24 horas.`
  }
  return null
}

/** Horário normalizado (espaços simples), para gravar e comparar. */
export function normalizarHorario(horario: string[]): string[] {
  return horario.map((dia) => (paresDoDia(dia) ?? []).map((par) => `${par.entrada}-${par.saida}`).join(' '))
}

/** Os dois são o mesmo horário da semana (depois de normalizados)? Aceita o que vier do banco. */
export function mesmoHorario(a: unknown, b: unknown): boolean {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== 7 || b.length !== 7) return false
  const outro = normalizarHorario(b.map(String))
  return normalizarHorario(a.map(String)).every((dia, i) => dia === outro[i])
}

/**
 * Sugestão a partir da jornada em minutos, para quem foi cadastrado antes do
 * horário contratual existir (o gestor confere e ajusta): começa às 08:00 e,
 * acima de 6 horas, tem 1 hora de intervalo depois das primeiras 4.
 */
export function horarioSugerido(jornada: number[]): string[] {
  const hora = (minutos: number) => `${String(Math.floor(minutos / 60) % 24).padStart(2, '0')}:${String(minutos % 60).padStart(2, '0')}`
  const inicio = 8 * 60
  return jornada.map((minutos) => {
    if (minutos <= 0) return ''
    if (minutos <= 6 * 60) return `${hora(inicio)}-${hora(inicio + minutos)}`
    return `${hora(inicio)}-${hora(inicio + 240)} ${hora(inicio + 300)}-${hora(inicio + 300 + minutos - 240)}`
  })
}

/** Horário para o espelho: "seg a sex 08:00-12:00 13:00-17:00 · sáb 08:00-12:00" (dias iguais seguidos juntam). */
export function textoDoHorario(horario: string[]): string {
  const grupos: Array<{ dias: number[]; texto: string }> = []
  for (const dia of [1, 2, 3, 4, 5, 6, 0]) {
    const texto = normalizarHorario([horario[dia] ?? ''])[0]
    const ultimo = grupos[grupos.length - 1]
    if (texto && ultimo && ultimo.texto === texto && ultimo.dias[ultimo.dias.length - 1] === (dia + 6) % 7) ultimo.dias.push(dia)
    else if (texto) grupos.push({ dias: [dia], texto })
  }
  if (grupos.length === 0) return 'sem horário contratual'
  return grupos
    .map(({ dias, texto }) => {
      const nome = dias.length === 1 ? DIAS_DA_SEMANA_CURTOS[dias[0]] : `${DIAS_DA_SEMANA_CURTOS[dias[0]]} a ${DIAS_DA_SEMANA_CURTOS[dias[dias.length - 1]]}`
      return `${nome} ${texto}`
    })
    .join(' · ')
}

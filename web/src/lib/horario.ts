import { jornadaDoHorario, paresDoDia } from '../../../functions/src/horario'
import { minutosParaHHMM } from './tempo'

// O horário contratual segue a mesma regra do servidor: a fonte única fica no
// backend (functions/src/horario.ts), usada no espelho e no AEJ.
export * from '../../../functions/src/horario'

const COMERCIAL = '08:00-12:00 13:00-17:00'
// Horários comuns (domingo a sábado), no cadastro e nas escalas; o gestor ajusta depois, se precisar.
export const MODELOS_HORARIO = [
  { rotulo: '44h · seg a sex 8h + sáb 4h', horario: ['', COMERCIAL, COMERCIAL, COMERCIAL, COMERCIAL, COMERCIAL, '08:00-12:00'] },
  { rotulo: '44h · seg a sex 8h48', horario: ['', ...Array(5).fill('08:00-12:00 13:00-17:48'), ''] },
  { rotulo: '40h · seg a sex 8h', horario: ['', ...Array(5).fill(COMERCIAL), ''] },
  { rotulo: '36h · seg a sáb 6h', horario: ['', ...Array(6).fill('08:00-14:00')] },
  { rotulo: '30h · seg a sex 6h', horario: ['', ...Array(5).fill('08:00-14:00'), ''] },
]

/** Minutos em horas: "8h", "8h48". */
function emHoras(minutos: number): string {
  return minutosParaHHMM(minutos).replace(/:00$/, 'h').replace(':', 'h')
}

/** Duração do dia para mostrar ao lado do horário: "8h", "8h48", "folga" ou "?" (formato errado). */
export function duracaoDoDia(texto: string): string {
  if (!paresDoDia(texto)) return '?'
  const minutos = jornadaDoHorario([texto])[0]
  return minutos === 0 ? 'folga' : emHoras(minutos)
}

/** Total da semana: "44h". */
export function totalSemanal(jornada: number[]): string {
  return emHoras(jornada.reduce((s, m) => s + m, 0))
}

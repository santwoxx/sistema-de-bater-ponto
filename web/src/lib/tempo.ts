// Utilitários de data/hora. Datas "locais" são strings AAAA-MM-DD calculadas
// no fuso da empresa (não no fuso do navegador de quem está olhando).

const formatadores = new Map<string, Intl.DateTimeFormat>()

function partes(data: Date, fuso: string) {
  let f = formatadores.get(fuso)
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: fuso,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    })
    formatadores.set(fuso, f)
  }
  const p: Record<string, string> = {}
  for (const parte of f.formatToParts(data)) if (parte.type !== 'literal') p[parte.type] = parte.value
  return p
}

export function dataLocal(data: Date, fuso: string): string {
  const p = partes(data, fuso)
  return `${p.year}-${p.month}-${p.day}`
}

export function horaLocal(data: Date, fuso: string, comSegundos = true): string {
  const p = partes(data, fuso)
  const hora = String(Number(p.hour) % 24).padStart(2, '0')
  return comSegundos ? `${hora}:${p.minute}:${p.second}` : `${hora}:${p.minute}`
}

export function formatarData(dataISO: string): string {
  const [ano, mes, dia] = dataISO.split('-')
  return `${dia}/${mes}/${ano}`
}

export function formatarDataHora(data: Date, fuso: string): string {
  return `${formatarData(dataLocal(data, fuso))} ${horaLocal(data, fuso, false)}`
}

export function dataPorExtenso(data: Date, fuso: string): string {
  return new Intl.DateTimeFormat('pt-BR', { timeZone: fuso, weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(data)
}

const NOMES_DIAS = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb']
export const NOMES_DIAS_LONGOS = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado']

export function diaSemana(dataISO: string): number {
  const [ano, mes, dia] = dataISO.split('-').map(Number)
  return new Date(Date.UTC(ano, mes - 1, dia)).getUTCDay()
}

export function nomeDiaCurto(dataISO: string): string {
  return NOMES_DIAS[diaSemana(dataISO)]
}

export function somarDias(dataISO: string, dias: number): string {
  const [ano, mes, dia] = dataISO.split('-').map(Number)
  return new Date(Date.UTC(ano, mes - 1, dia + dias)).toISOString().slice(0, 10)
}

export function diasDoMes(mes: string): string[] {
  const [ano, numeroMes] = mes.split('-').map(Number)
  const total = new Date(Date.UTC(ano, numeroMes, 0)).getUTCDate()
  return Array.from({ length: total }, (_, i) => `${mes}-${String(i + 1).padStart(2, '0')}`)
}

/** "2026-01", -1 → "2025-12". */
export function somarMeses(mes: string, quantidade: number): string {
  const [ano, numeroMes] = mes.split('-').map(Number)
  const data = new Date(Date.UTC(ano, numeroMes - 1 + quantidade, 1))
  return data.toISOString().slice(0, 7)
}

export function nomeMes(mes: string): string {
  const [ano, numeroMes] = mes.split('-').map(Number)
  const nome = new Intl.DateTimeFormat('pt-BR', { month: 'long', timeZone: 'UTC' }).format(new Date(Date.UTC(ano, numeroMes - 1, 1)))
  return `${nome.charAt(0).toUpperCase()}${nome.slice(1)} de ${ano}`
}

export function diferencaDias(de: string, ate: string): number {
  const ms = (d: string) => {
    const [a, m, dia] = d.split('-').map(Number)
    return Date.UTC(a, m - 1, dia)
  }
  return Math.round((ms(ate) - ms(de)) / 86_400_000)
}

/** 480 → "08:00"; com sinal: 90 → "+01:30", -5 → "-00:05". */
export function minutosParaHHMM(minutos: number, comSinal = false): string {
  const negativo = minutos < 0
  const absoluto = Math.abs(Math.round(minutos))
  const texto = `${String(Math.floor(absoluto / 60)).padStart(2, '0')}:${String(absoluto % 60).padStart(2, '0')}`
  if (negativo) return `-${texto}`
  return comSinal && absoluto > 0 ? `+${texto}` : texto
}

/** "08:00" → 480. Retorna NaN se o formato for inválido. */
export function hhmmParaMinutos(texto: string): number {
  const encontrado = /^(\d{1,2}):([0-5]\d)$/.exec(texto.trim())
  if (!encontrado) return Number.NaN
  const minutos = Number(encontrado[1]) * 60 + Number(encontrado[2])
  return minutos <= 24 * 60 ? minutos : Number.NaN
}

export function tempoRelativo(instanteMs: number, agoraMs = Date.now()): string {
  const segundos = Math.max(0, Math.round((agoraMs - instanteMs) / 1000))
  if (segundos < 60) return 'agora mesmo'
  const minutos = Math.round(segundos / 60)
  if (minutos < 60) return `há ${minutos} min`
  const horas = Math.round(minutos / 60)
  if (horas < 24) return `há ${horas} h`
  const dias = Math.round(horas / 24)
  return dias === 1 ? 'há 1 dia' : `há ${dias} dias`
}

export const FUSOS_BRASIL = [
  { valor: 'America/Sao_Paulo', rotulo: 'Horário de Brasília (UTC−3)' },
  { valor: 'America/Manaus', rotulo: 'AM, MT, MS, RO, RR (UTC−4)' },
  { valor: 'America/Rio_Branco', rotulo: 'Acre e oeste do AM (UTC−5)' },
  { valor: 'America/Noronha', rotulo: 'Fernando de Noronha (UTC−2)' },
]

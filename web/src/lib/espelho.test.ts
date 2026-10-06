import { describe, expect, it } from 'vitest'
import { calcularEspelho, type AbonoBruto, type MarcacaoBruta } from './espelho'

const JORNADA = [0, 480, 480, 480, 480, 480, 240] // dom..sáb
let seq = 0
function marcacoes(data: string, ...horas: string[]): MarcacaoBruta[] {
  return horas.map((h) => ({ id: `r${seq++}`, dataLocal: data, horaLocal: `${h}:00`, origem: 'dispositivo', desconsiderado: null }))
}

function calcular(
  registros: MarcacaoBruta[],
  extra: { hoje?: string; admissao?: string; inicioControle?: string; toleranciaMin?: number; abonos?: AbonoBruto[] } = {},
) {
  return calcularEspelho({
    mes: '2026-10',
    registros,
    jornada: JORNADA,
    hoje: extra.hoje ?? '2026-11-15',
    admissao: extra.admissao ?? null,
    inicioControle: extra.inicioControle ?? null,
    abonos: extra.abonos ?? [],
    toleranciaMin: extra.toleranciaMin ?? 10,
  })
}

const dia = (resumo: ReturnType<typeof calcular>, data: string) => resumo.dias.find((d) => d.data === data)!

describe('espelho de ponto', () => {
  it('soma pares entrada/saída de um dia normal', () => {
    // 05/10/2026 é segunda-feira
    const r = calcular(marcacoes('2026-10-05', '08:00', '12:00', '13:00', '17:00'))
    const d = dia(r, '2026-10-05')
    expect(d.diaSemana).toBe(1)
    expect(d.trabalhadoMin).toBe(480)
    expect(d.saldoMin).toBe(0)
    expect(d.marcacoes.map((m) => m.tipo)).toEqual(['entrada', 'saida', 'entrada', 'saida'])
  })

  it('calcula hora extra e respeita a tolerância diária', () => {
    const extra = dia(calcular(marcacoes('2026-10-06', '08:00', '12:00', '13:00', '18:30')), '2026-10-06')
    expect(extra.saldoMin).toBe(90)
    const tolerado = dia(calcular(marcacoes('2026-10-07', '08:05', '12:00', '13:00', '17:00')), '2026-10-07')
    expect(tolerado.trabalhadoMin).toBe(475)
    expect(tolerado.saldoMin).toBe(0)
    const semTolerancia = dia(calcular(marcacoes('2026-10-07', '08:05', '12:00', '13:00', '17:00'), { toleranciaMin: 0 }), '2026-10-07')
    expect(semTolerancia.saldoMin).toBe(-5)
  })

  it('marca dia incompleto (marcação ímpar) e conta só pares fechados', () => {
    const d = dia(calcular(marcacoes('2026-10-08', '08:00', '12:00', '13:00')), '2026-10-08')
    expect(d.incompleto).toBe(true)
    expect(d.trabalhadoMin).toBe(240)
  })

  it('ignora marcações desconsideradas', () => {
    const registros = marcacoes('2026-10-09', '08:00', '08:01', '17:00')
    registros[1].desconsiderado = { motivo: 'duplicada' }
    const d = dia(calcular(registros), '2026-10-09')
    expect(d.marcacoes).toHaveLength(2)
    expect(d.trabalhadoMin).toBe(540)
    expect(d.incompleto).toBe(false)
  })

  it('aponta falta em dia útil sem marcação e não em domingo', () => {
    const r = calcular([])
    expect(dia(r, '2026-10-05').falta).toBe(true)
    expect(dia(r, '2026-10-05').saldoMin).toBe(-480)
    expect(dia(r, '2026-10-04').falta).toBe(false) // domingo
  })

  it('não fecha saldo de hoje nem de dias futuros', () => {
    const r = calcular(marcacoes('2026-10-20', '08:00'), { hoje: '2026-10-20' })
    expect(dia(r, '2026-10-20').situacao).toBe('hoje')
    expect(dia(r, '2026-10-20').saldoMin).toBeNull()
    expect(dia(r, '2026-10-20').incompleto).toBe(false)
    expect(dia(r, '2026-10-21').situacao).toBe('futuro')
    expect(r.dias.filter((d) => d.saldoMin !== null)).toHaveLength(19)
  })

  it('não cobra jornada antes da admissão', () => {
    const r = calcular([], { admissao: '2026-10-15' })
    expect(dia(r, '2026-10-14').previstoMin).toBe(0)
    expect(dia(r, '2026-10-14').falta).toBe(false)
    expect(dia(r, '2026-10-15').previstoMin).toBe(480)
  })

  it('antes do início do controle, dia sem marcação não é falta, mas marcação lançada conta', () => {
    const r = calcular(marcacoes('2026-10-02', '08:00', '12:00', '13:00', '17:30'), { inicioControle: '2026-10-05' })
    expect(dia(r, '2026-10-01').situacao).toBe('antes-inicio')
    expect(dia(r, '2026-10-01').falta).toBe(false)
    expect(dia(r, '2026-10-01').saldoMin).toBeNull()
    expect(dia(r, '2026-10-02').situacao).toBe('normal')
    expect(dia(r, '2026-10-02').saldoMin).toBe(30)
    expect(dia(r, '2026-10-05').falta).toBe(true)
    expect(r.saldoMin).toBe(30 - r.dias.filter((d) => d.falta).reduce((s, d) => s + d.previstoMin, 0))
  })

  it('abono de dia inteiro evita a falta; trabalho no dia abonado vira saldo positivo', () => {
    const abonos: AbonoBruto[] = [
      { id: 'a1', data: '2026-10-12', tipo: 'feriado', descricao: 'Nossa Senhora Aparecida', minutos: null },
      { id: 'a2', data: '2026-10-13', tipo: 'feriado', descricao: 'Ponte', minutos: null },
    ]
    const r = calcular(marcacoes('2026-10-13', '09:00', '13:00'), { abonos })
    expect(dia(r, '2026-10-12').falta).toBe(false)
    expect(dia(r, '2026-10-12').previstoMin).toBe(0)
    expect(dia(r, '2026-10-12').saldoMin).toBe(0)
    expect(dia(r, '2026-10-12').abonos[0].descricao).toBe('Nossa Senhora Aparecida')
    expect(dia(r, '2026-10-13').saldoMin).toBe(240)
  })

  it('abono parcial abate só as horas abonadas', () => {
    const abonos: AbonoBruto[] = [{ id: 'a1', data: '2026-10-14', tipo: 'atestado', descricao: 'Consulta médica', minutos: 120 }]
    const veio = dia(calcular(marcacoes('2026-10-14', '08:00', '12:00', '13:00', '15:00'), { abonos }), '2026-10-14')
    expect(veio.previstoMin).toBe(360)
    expect(veio.saldoMin).toBe(0)
    const naoVeio = dia(calcular([], { abonos }), '2026-10-14')
    expect(naoVeio.falta).toBe(true)
    expect(naoVeio.saldoMin).toBe(-360)
  })

  it('totaliza o mês', () => {
    const registros = [
      ...marcacoes('2026-10-05', '08:00', '12:00', '13:00', '17:00'),
      ...marcacoes('2026-10-06', '08:00', '12:00', '13:00', '18:00'),
    ]
    const r = calcular(registros, { hoje: '2026-10-07' })
    expect(r.totalTrabalhadoMin).toBe(1020)
    expect(r.diasTrabalhados).toBe(2)
    // 01/10 (qui), 02/10 (sex) e 03/10 (sáb) sem marcação = faltas.
    expect(r.faltas).toBe(3)
    expect(r.saldoMin).toBe(60 - 480 - 480 - 240)
  })
})

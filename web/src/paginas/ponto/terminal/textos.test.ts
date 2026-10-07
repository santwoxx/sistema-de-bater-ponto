import { describe, expect, it } from 'vitest'
import { instrucaoDaTela, textoDeEspera, tituloDaTela, type EstadoTexto } from './textos'

const estado = (parcial: Partial<EstadoTexto>): EstadoTexto => ({ etapa: 'matricula', modo: 'ponto', salvandoPin: false, erroPin: '', ...parcial })

describe('textos do aparelho', () => {
  it('guia o ponto: matrícula, PIN e câmera', () => {
    expect(tituloDaTela(estado({}))).toBe('Digite sua matrícula')
    expect(tituloDaTela(estado({ etapa: 'pin' }))).toBe('Digite seu PIN')
    expect(instrucaoDaTela(estado({ etapa: 'pin' }))).toMatch(/olhe para a câmera/)
    expect(tituloDaTela(estado({ etapa: 'foto' }))).toBe('Olhe para a câmera')
    expect(instrucaoDaTela(estado({ etapa: 'enviando' }))).toBe('Fique parado, olhando para a câmera.')
  })

  it('explica o PIN provisório no primeiro uso e mostra o erro do PIN novo', () => {
    expect(tituloDaTela(estado({ etapa: 'novoPin' }))).toBe('Crie seu PIN pessoal')
    expect(instrucaoDaTela(estado({ etapa: 'novoPin' }))).toMatch(/provisório/)
    expect(instrucaoDaTela(estado({ etapa: 'novoPin', erroPin: 'Muito fácil' }))).toBe('Muito fácil')
    expect(tituloDaTela(estado({ etapa: 'confirmarPin' }))).toBe('Digite o novo PIN de novo')
  })

  it('troca de PIN pede o atual e depois o novo', () => {
    expect(tituloDaTela(estado({ modo: 'trocarPin' }))).toBe('Trocar PIN: digite sua matrícula')
    expect(tituloDaTela(estado({ modo: 'trocarPin', etapa: 'pin' }))).toBe('Digite seu PIN atual')
    expect(tituloDaTela(estado({ modo: 'trocarPin', etapa: 'novoPin' }))).toBe('Digite o novo PIN')
  })

  it('mostra o que está esperando do servidor', () => {
    expect(textoDeEspera({ modo: 'ponto', salvandoPin: true })).toBe('Salvando seu PIN...')
    expect(textoDeEspera({ modo: 'solicitacao', salvandoPin: false })).toBe('Enviando a solicitação...')
    expect(tituloDaTela(estado({ modo: 'assinatura', etapa: 'enviando' }))).toBe('Buscando seus espelhos...')
    expect(instrucaoDaTela(estado({ modo: 'assinatura', etapa: 'enviando' }))).toBe('Aguarde um instante.')
  })
})

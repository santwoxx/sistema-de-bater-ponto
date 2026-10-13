import { describe, expect, it } from 'vitest'
import { instrucaoDaTela, nomeCurto, PIN_INCORRETO, primeiroNome, tituloDaTela } from './textos'

describe('textos do aparelho', () => {
  it('guia o ponto: só o PIN, depois a câmera', () => {
    expect(tituloDaTela('pin', null)).toBe('Digite seu PIN')
    expect(instrucaoDaTela('pin')).toMatch(/olhe para a câmera/)
    expect(tituloDaTela('foto', null)).toBe('Olhe para a câmera')
    expect(tituloDaTela('enviando', null)).toBe('Registrando...')
    expect(instrucaoDaTela('enviando')).toBe('Fique parado, olhando para a câmera.')
    expect(PIN_INCORRETO).toBe('PIN incorreto. Confira o seu PIN e tente de novo.')
  })

  it('nome curto das empresas no topo do aparelho que atende várias', () => {
    expect(nomeCurto('CENTRAL PNEUS COMÉRCIO E IMPORTADORA DE PNEUS LTDA')).toBe('CENTRAL PNEUS')
    expect(nomeCurto('ITABUNA PNEUS LTDA')).toBe('ITABUNA PNEUS')
    expect(nomeCurto('IVONE PNEUS COMÉRCIO E IMPORTADORA LTDA')).toBe('IVONE PNEUS')
    expect(nomeCurto('Padaria Pão Quente Comercio de Alimentos Ltda.')).toBe('Padaria Pão Quente')
    expect(nomeCurto('Mercado Bom Preço S/A')).toBe('Mercado Bom Preço')
    expect(nomeCurto('Loja Centro')).toBe('Loja Centro')
    // Descrição no começo do nome fica (senão sobraria só o sufixo).
    expect(nomeCurto('Distribuidora Sol LTDA')).toBe('Distribuidora Sol')
    expect(nomeCurto('  ME  ')).toBe('ME')
  })

  it('no celular pessoal, cumprimenta o dono', () => {
    expect(primeiroNome('ELIANA MOREIRA DOS SANTOS')).toBe('Eliana')
    expect(tituloDaTela('pin', 'ELIANA MOREIRA DOS SANTOS')).toBe('Olá, Eliana! Digite seu PIN')
  })
})

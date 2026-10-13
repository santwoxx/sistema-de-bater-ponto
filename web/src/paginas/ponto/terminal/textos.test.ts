import { describe, expect, it } from 'vitest'
import { instrucaoDaTela, PIN_INCORRETO, primeiroNome, tituloDaTela } from './textos'

describe('textos do aparelho', () => {
  it('guia o ponto: só o PIN, depois a câmera', () => {
    expect(tituloDaTela('pin', null)).toBe('Digite seu PIN')
    expect(instrucaoDaTela('pin')).toMatch(/olhe para a câmera/)
    expect(tituloDaTela('foto', null)).toBe('Olhe para a câmera')
    expect(tituloDaTela('enviando', null)).toBe('Registrando...')
    expect(instrucaoDaTela('enviando')).toBe('Fique parado, olhando para a câmera.')
    expect(PIN_INCORRETO).toBe('PIN incorreto. Confira o seu PIN e tente de novo.')
  })

  it('no celular pessoal, cumprimenta o dono', () => {
    expect(primeiroNome('ELIANA MOREIRA DOS SANTOS')).toBe('Eliana')
    expect(tituloDaTela('pin', 'ELIANA MOREIRA DOS SANTOS')).toBe('Olá, Eliana! Digite seu PIN')
  })
})

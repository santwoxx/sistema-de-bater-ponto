import { describe, expect, it } from 'vitest'
import { cpfNoVisor, instrucaoDaTela, mensagemRecusa, primeiroNome, tituloDaTela } from './textos'

describe('textos do aparelho', () => {
  it('guia o ponto no aparelho da loja: CPF, PIN e câmera', () => {
    expect(tituloDaTela('cpf', null)).toBe('Digite seu CPF')
    expect(instrucaoDaTela('cpf')).toMatch(/números do CPF/)
    expect(tituloDaTela('pin', null)).toBe('Digite seu PIN')
    expect(instrucaoDaTela('pin')).toMatch(/olhe para a câmera/)
    expect(tituloDaTela('foto', null)).toBe('Olhe para a câmera')
    expect(tituloDaTela('enviando', null)).toBe('Registrando...')
    expect(instrucaoDaTela('enviando')).toBe('Fique parado, olhando para a câmera.')
  })

  it('formata o CPF enquanto é digitado', () => {
    expect(cpfNoVisor('')).toBe('')
    expect(cpfNoVisor('529')).toBe('529')
    expect(cpfNoVisor('5299822')).toBe('529.982.2')
    expect(cpfNoVisor('529982247')).toBe('529.982.247')
    expect(cpfNoVisor('52998224725')).toBe('529.982.247-25')
  })

  it('no celular pessoal, cumprimenta o dono e a recusa só pode ser do PIN', () => {
    expect(primeiroNome('ELIANA MOREIRA DOS SANTOS')).toBe('Eliana')
    expect(tituloDaTela('pin', 'ELIANA MOREIRA DOS SANTOS')).toBe('Olá, Eliana! Digite seu PIN')
    expect(mensagemRecusa(true)).toBe('PIN incorreto. Confira o seu PIN e tente de novo.')
    expect(mensagemRecusa(false)).toBe('CPF ou PIN incorretos. Confira e tente de novo.')
  })
})

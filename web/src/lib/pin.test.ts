import { describe, expect, it } from 'vitest'
import { problemaNoPin } from './pin'

describe('PIN novo no aparelho', () => {
  it('aceita 4 a 6 números que não sejam óbvios', () => {
    for (const bom of ['1357', '2580', '402816']) expect(problemaNoPin(bom), bom).toBeNull()
  })

  it('recusa tamanho errado, sequências e repetições (mesma regra do servidor)', () => {
    expect(problemaNoPin('123')).toMatch(/4 a 6/)
    expect(problemaNoPin('1234567')).toMatch(/4 a 6/)
    for (const fraco of ['0000', '1234', '4321', '7890', '987654']) expect(problemaNoPin(fraco), fraco).toMatch(/adivinhar/)
  })
})

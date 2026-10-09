import { describe, expect, it } from 'vitest'
import { gerarPin, problemaNoPin } from './pin'

describe('PIN do ponto (4 números)', () => {
  it('aceita 4 números que não sejam óbvios', () => {
    for (const bom of ['1357', '2580', '0472']) expect(problemaNoPin(bom), bom).toBeNull()
  })

  it('recusa tamanho errado, sequências e repetições (mesma regra do servidor)', () => {
    for (const tamanho of ['123', '12345', '402816']) expect(problemaNoPin(tamanho), tamanho).toMatch(/4 números/)
    for (const fraco of ['0000', '1234', '4321', '7890']) expect(problemaNoPin(fraco), fraco).toMatch(/adivinhar/)
  })

  it('gera PINs de 4 números que passam na regra', () => {
    for (let i = 0; i < 500; i++) expect(problemaNoPin(gerarPin())).toBeNull()
  })
})

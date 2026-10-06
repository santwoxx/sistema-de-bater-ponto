import { describe, expect, it } from 'vitest'
import { mensagemErro } from './erros'

describe('mensagemErro', () => {
  it('mostra a mensagem do servidor sem o status HTTP que o SDK acrescenta', () => {
    expect(mensagemErro({ code: 'functions/permission-denied', message: 'Matrícula ou PIN inválidos. [403]' })).toBe(
      'Matrícula ou PIN inválidos.',
    )
  })

  it('traduz erros internos que não trazem mensagem própria', () => {
    expect(mensagemErro({ code: 'functions/internal', message: 'internal [500]' })).toBe('Erro interno no servidor. Tente novamente em instantes.')
  })

  it('traduz erros de login', () => {
    expect(mensagemErro({ code: 'auth/invalid-credential', message: 'Firebase: Error (auth/invalid-credential).' })).toBe(
      'E-mail ou senha incorretos.',
    )
  })
})

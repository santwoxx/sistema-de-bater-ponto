import { describe, expect, it } from 'vitest'
import { cancelouJanela, mensagemErro } from './erros'

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

  it('conta Google sem cadastro e janela bloqueada têm mensagem própria', () => {
    expect(mensagemErro({ code: 'auth/admin-restricted-operation', message: 'Firebase: Error (auth/admin-restricted-operation).' })).toMatch(
      /não está cadastrada/,
    )
    expect(mensagemErro({ code: 'auth/popup-blocked', message: 'Firebase: Error (auth/popup-blocked).' })).toMatch(/bloqueou a janela/)
  })
})

describe('cancelouJanela', () => {
  it('fechar ou cancelar a janela do Google não é erro', () => {
    expect(cancelouJanela({ code: 'auth/popup-closed-by-user' })).toBe(true)
    expect(cancelouJanela({ code: 'auth/cancelled-popup-request' })).toBe(true)
    expect(cancelouJanela({ code: 'auth/popup-blocked' })).toBe(false)
    expect(cancelouJanela(null)).toBe(false)
  })
})

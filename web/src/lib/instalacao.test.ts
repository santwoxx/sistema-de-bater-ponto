import { describe, expect, it } from 'vitest'
import { comoInstalar, situacaoDaInstalacao } from './instalacao'

const GALAXY_TAB_SAMSUNG =
  'Mozilla/5.0 (Linux; Android 13; SM-X200) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/23.0 Chrome/115.0.0.0 Safari/537.36'
const GALAXY_TAB_CHROME = 'Mozilla/5.0 (Linux; Android 13; SM-X200) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36'
const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1'
const IPAD_COMO_MAC = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15'
const WINDOWS_CHROME = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36'

describe('instalar como app', () => {
  it('explica onde fica a instalação no menu de cada navegador', () => {
    // A Internet Samsung também se apresenta como Chrome: vem primeiro.
    expect(comoInstalar(GALAXY_TAB_SAMSUNG)).toMatch(/Internet Samsung.*"Adicionar página a".*"Tela inicial"/)
    expect(comoInstalar(GALAXY_TAB_CHROME)).toMatch(/Chrome.*"Instalar app"/)
    expect(comoInstalar(IPHONE)).toMatch(/Safari.*"Adicionar à Tela de Início"/)
    // iPad recente se apresenta como Mac, mas tem tela de toque.
    expect(comoInstalar(IPAD_COMO_MAC, 5)).toMatch(/"Adicionar à Tela de Início"/)
    expect(comoInstalar(WINDOWS_CHROME)).toMatch(/barra de endereço/)
  })

  it('sem aviso do navegador, a instalação é pelo menu', () => {
    expect(situacaoDaInstalacao()).toBe('pelo-menu')
  })
})

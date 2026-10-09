import { describe, expect, it } from 'vitest'
import { mensagemDaCamera, navegadorInterno, nomeDoErro, plataformaDe, tentarOutraConfiguracao } from './camera'

const CHROME_ANDROID = 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/154.0.0.0 Mobile Safari/537.36'
const SAFARI_IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1'
const IPAD = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15'
const INSTAGRAM = `${SAFARI_IPHONE} Instagram 350.0.0.0 (iPhone14,2; iOS 18_0)`
const WEBVIEW_ANDROID = 'Mozilla/5.0 (Linux; Android 10; K; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/154.0.0.0 Mobile Safari/537.36'

describe('câmera: aparelho e navegador', () => {
  it('reconhece Android, iPhone e iPad (que se apresenta como Mac, mas tem toque)', () => {
    expect(plataformaDe(CHROME_ANDROID)).toBe('android')
    expect(plataformaDe(SAFARI_IPHONE)).toBe('ios')
    expect(plataformaDe(IPAD, 5)).toBe('ios')
    expect(plataformaDe(IPAD, 0)).toBe('outro')
  })

  it('reconhece navegador interno de outro aplicativo, mas não o Chrome nem o Safari', () => {
    expect(navegadorInterno(INSTAGRAM)).toBe('Instagram')
    expect(navegadorInterno(WEBVIEW_ANDROID)).toBe('outro aplicativo')
    expect(navegadorInterno(CHROME_ANDROID)).toBeNull()
    expect(navegadorInterno(SAFARI_IPHONE)).toBeNull()
  })
})

describe('câmera: o que fazer em cada erro', () => {
  it('tenta configuração mais simples quando a câmera não abre, mas não quando foi bloqueada', () => {
    expect(tentarOutraConfiguracao('NotReadableError')).toBe(true)
    expect(tentarOutraConfiguracao('OverconstrainedError')).toBe(true)
    expect(tentarOutraConfiguracao('SemImagem')).toBe(true)
    expect(tentarOutraConfiguracao('NotAllowedError')).toBe(false)
    expect(tentarOutraConfiguracao('SecurityError')).toBe(false)
    expect(nomeDoErro(new DOMException('x', 'NotReadableError'))).toBe('NotReadableError')
    expect(nomeDoErro(null)).toBe('Error')
  })

  it('explica como liberar a câmera no aparelho certo', () => {
    expect(mensagemDaCamera('NotAllowedError', 'android', null)).toMatch(/Chrome.*Permissões › Câmera › Permitir/)
    expect(mensagemDaCamera('NotAllowedError', 'ios', null)).toMatch(/Safari.*aA.*Câmera › Permitir/)
    expect(mensagemDaCamera('SemSuporte', 'ios', 'Instagram')).toMatch(/Instagram.*Safari/)
    expect(mensagemDaCamera('SemSuporte', 'android', 'WhatsApp')).toMatch(/WhatsApp.*Chrome/)
    expect(mensagemDaCamera('NotReadableError', 'android', null)).toMatch(/outro aplicativo/)
    expect(mensagemDaCamera('Aguardando', 'android', null)).toMatch(/Ligar a câmera.*Permitir/)
    expect(mensagemDaCamera('algo-novo', 'outro', null)).toMatch(/Tentar novamente/)
  })
})

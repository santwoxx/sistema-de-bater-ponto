import { describe, expect, it } from 'vitest'
import { limiteAtingido, MAX_GUARDADAS, MAX_POR_MATRICULA, selar } from './semInternet'

const base64 = (dados: ArrayBuffer) => btoa(String.fromCharCode(...new Uint8Array(dados)))
const bytes = (texto: string) => Uint8Array.from(atob(texto), (c) => c.charCodeAt(0))

describe('batida guardada sem internet', () => {
  it('fica cifrada: só quem tem a chave privada (o servidor) abre', async () => {
    const subtle = globalThis.crypto.subtle
    const par = await subtle.generateKey(
      { name: 'RSA-OAEP', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
      true,
      ['encrypt', 'decrypt'],
    )
    const chavePublica = base64(await subtle.exportKey('spki', par.publicKey))
    const conteudo = { matricula: '12', pin: '3691', foto: 'data:image/jpeg;base64,/9j/AAAA' }

    const pacote = await selar(chavePublica, conteudo)
    expect(pacote.versao).toBe(1)
    expect(JSON.stringify(pacote)).not.toContain('3691')

    // O que o servidor faz (functions/src/semInternet.ts, abrirPacote), aqui com Web Crypto.
    const chaveAes = await subtle.decrypt({ name: 'RSA-OAEP' }, par.privateKey, bytes(pacote.chave))
    const aes = await subtle.importKey('raw', chaveAes, 'AES-GCM', false, ['decrypt'])
    const aberto = await subtle.decrypt({ name: 'AES-GCM', iv: bytes(pacote.iv) }, aes, bytes(pacote.dados))
    expect(JSON.parse(new TextDecoder().decode(aberto))).toEqual(conteudo)
  })

  it('limita quantas batidas o aparelho guarda, no total e por matrícula', () => {
    const guardadas = (quantidade: number, matricula = '12') => Array.from({ length: quantidade }, () => ({ matricula }))
    expect(limiteAtingido(guardadas(MAX_POR_MATRICULA - 1), '12')).toBeNull()
    // "0012" e "12" são a mesma matrícula.
    expect(limiteAtingido(guardadas(MAX_POR_MATRICULA), '0012')).toMatch(/muitas batidas/)
    expect(limiteAtingido(guardadas(MAX_POR_MATRICULA), '7')).toBeNull()
    expect(limiteAtingido(guardadas(MAX_GUARDADAS, '99'), '7')).toMatch(/já guardou/)
  })
})

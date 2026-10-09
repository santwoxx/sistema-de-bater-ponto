import { describe, expect, it } from 'vitest'
import { scriptPrincipal } from './useAtualizacaoAutomatica'

describe('versão do site no aparelho', () => {
  it('reconhece o script principal publicado (o nome muda a cada versão)', () => {
    const html = '<script type="module" crossorigin src="/assets/index-DMKwoqQW.js"></script><link rel="stylesheet" href="/assets/index-Bx9_k.css">'
    expect(scriptPrincipal(html)).toBe('/assets/index-DMKwoqQW.js')
    expect(scriptPrincipal('<script type="module" src="/src/main.tsx"></script>')).toBeNull()
  })
})

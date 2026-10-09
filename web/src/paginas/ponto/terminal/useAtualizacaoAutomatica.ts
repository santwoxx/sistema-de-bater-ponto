import { useEffect, useState } from 'react'

const VERIFICAR_A_CADA_MS = 10 * 60_000
/** Tela parada por este tempo antes de recarregar (ninguém chegando para bater o ponto). */
const ESPERA_PARADA_MS = 15_000
/** O script principal muda de nome a cada publicação (o nome traz o hash do conteúdo). */
const SCRIPT_PRINCIPAL = /\/assets\/index-[\w-]+\.js/

export function scriptPrincipal(html: string): string | null {
  return SCRIPT_PRINCIPAL.exec(html)?.[0] ?? null
}

/**
 * O aparelho de ponto fica dias com a página aberta, então uma correção
 * publicada só chegaria nele quando alguém recarregasse. A cada 10 minutos (e
 * quando a internet volta) ele confere se há versão nova e, havendo, recarrega
 * sozinho num momento sem ninguém usando. Batidas guardadas sem internet
 * continuam no aparelho (ficam no IndexedDB).
 */
export function useAtualizacaoAutomatica(semNinguemUsando: boolean) {
  const [novaVersao, setNovaVersao] = useState(false)

  useEffect(() => {
    // Em desenvolvimento não há script com hash: nada a fazer.
    const atual = scriptPrincipal(document.documentElement.innerHTML)
    if (!atual) return
    const verificar = async () => {
      try {
        const publicada = scriptPrincipal(await (await fetch('/', { cache: 'no-store' })).text())
        if (publicada && publicada !== atual) setNovaVersao(true)
      } catch {
        // sem internet: confere na próxima vez
      }
    }
    const id = setInterval(() => void verificar(), VERIFICAR_A_CADA_MS)
    const aoVoltarInternet = () => void verificar()
    window.addEventListener('online', aoVoltarInternet)
    return () => {
      clearInterval(id)
      window.removeEventListener('online', aoVoltarInternet)
    }
  }, [])

  useEffect(() => {
    if (!novaVersao || !semNinguemUsando) return
    const id = setTimeout(() => window.location.reload(), ESPERA_PARADA_MS)
    return () => clearTimeout(id)
  }, [novaVersao, semNinguemUsando])
}

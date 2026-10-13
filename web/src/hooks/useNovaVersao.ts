import { useEffect, useState } from 'react'

const VERIFICAR_A_CADA_MS = 10 * 60_000
/** O script principal muda de nome a cada publicação (o nome traz o hash do conteúdo). */
const SCRIPT_PRINCIPAL = /\/assets\/index-[\w-]+\.js/

export function scriptPrincipal(html: string): string | null {
  return SCRIPT_PRINCIPAL.exec(html)?.[0] ?? null
}

/** Se já há uma versão do site mais nova que a aberta (confere de tempos em tempos). */
export function useNovaVersao(): boolean {
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
    const aoVoltarATela = () => {
      if (document.visibilityState === 'visible') void verificar()
    }
    window.addEventListener('online', aoVoltarInternet)
    document.addEventListener('visibilitychange', aoVoltarATela)
    return () => {
      clearInterval(id)
      window.removeEventListener('online', aoVoltarInternet)
      document.removeEventListener('visibilitychange', aoVoltarATela)
    }
  }, [])

  return novaVersao
}

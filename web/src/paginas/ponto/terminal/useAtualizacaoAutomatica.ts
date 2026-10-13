import { useEffect } from 'react'
import { useNovaVersao } from '../../../hooks/useNovaVersao'

/** Tela parada por este tempo antes de recarregar (ninguém chegando para bater o ponto). */
const ESPERA_PARADA_MS = 15_000

/**
 * O aparelho de ponto fica dias com a página aberta, então uma correção
 * publicada só chegaria nele quando alguém recarregasse. A cada 10 minutos,
 * quando a internet volta e quando a tela volta a aparecer (celular
 * desbloqueado), ele confere se há versão nova e, havendo, recarrega sozinho
 * num momento sem ninguém usando. Batidas guardadas sem internet
 * continuam no aparelho (ficam no IndexedDB).
 */
export function useAtualizacaoAutomatica(semNinguemUsando: boolean) {
  const novaVersao = useNovaVersao()

  useEffect(() => {
    if (!novaVersao || !semNinguemUsando) return
    const id = setTimeout(() => window.location.reload(), ESPERA_PARADA_MS)
    return () => clearTimeout(id)
  }, [novaVersao, semNinguemUsando])
}

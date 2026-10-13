import { useSyncExternalStore } from 'react'
import { acompanharInstalacao, instalar, situacaoDaInstalacao } from '../lib/instalacao'

/** Se o sistema já está instalado como app, se dá para instalar com um botão ou só pelo menu (ver lib/instalacao.ts). */
export function useInstalacao() {
  const situacao = useSyncExternalStore(acompanharInstalacao, situacaoDaInstalacao)
  return { situacao, instalar }
}

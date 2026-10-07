import { useCallback, useEffect, useState } from 'react'
import { api, type Sincronizacao } from '../../../api'
import { gravarLocal, lerLocal } from '../../../lib/util'

export type InfoAparelho = Extract<Sincronizacao, { ativo: true }>

/** Última informação recebida do servidor, para a tela abrir mesmo sem internet. */
export const CHAVE_INFO = 'ponto.info'
const SINCRONIZAR_A_CADA_MS = 5 * 60_000

// Hora oficial: o relógio do aparelho pode estar errado, então a tela usa a
// hora do servidor (corrigida pela latência). O registro em si é sempre
// carimbado pelo servidor.
export function useSincronizacao() {
  const [info, setInfo] = useState<InfoAparelho | null>(() => JSON.parse(lerLocal(CHAVE_INFO) ?? 'null'))
  const [deslocamento, setDeslocamento] = useState(0)
  const [conectado, setConectado] = useState(() => navigator.onLine)
  const [desativado, setDesativado] = useState(false)

  const sincronizar = useCallback(async () => {
    const inicio = Date.now()
    try {
      const resposta = await api.sincronizarDispositivo({})
      const fim = Date.now()
      setConectado(true)
      setDeslocamento(resposta.agora - (inicio + fim) / 2)
      if (!resposta.ativo) {
        setDesativado(true)
        return
      }
      setInfo(resposta)
      gravarLocal(CHAVE_INFO, JSON.stringify(resposta))
    } catch {
      setConectado(false)
    }
  }, [])

  useEffect(() => {
    // Sincroniza com um sistema externo; o estado só muda quando ele responde.
    // oxlint-disable-next-line react/set-state-in-effect
    void sincronizar()
    const id = setInterval(sincronizar, SINCRONIZAR_A_CADA_MS)
    const online = () => void sincronizar()
    const offline = () => setConectado(false)
    window.addEventListener('online', online)
    window.addEventListener('offline', offline)
    return () => {
      clearInterval(id)
      window.removeEventListener('online', online)
      window.removeEventListener('offline', offline)
    }
  }, [sincronizar])

  return { info, deslocamento, conectado, desativado, setConectado }
}

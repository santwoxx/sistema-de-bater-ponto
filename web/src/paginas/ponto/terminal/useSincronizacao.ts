import { useCallback, useEffect, useRef, useState } from 'react'
import { api, type Sincronizacao } from '../../../api'
import type { DiagnosticoCamera } from '../../../hooks/useCamera'
import { gravarLocal, lerLocal } from '../../../lib/util'
import { guardarReferencia } from './semInternet'

export type InfoAparelho = Extract<Sincronizacao, { ativo: true }>

/** Última informação recebida do servidor, para a tela abrir mesmo sem internet. */
export const CHAVE_INFO = 'ponto.info'
const SINCRONIZAR_A_CADA_MS = 5 * 60_000
/** Mudança no estado da câmera é informada ao painel logo depois (sem esperar 5 min). */
const AVISAR_CAMERA_MS = 2_000

// Hora oficial: o relógio do aparelho pode estar errado, então a tela usa a
// hora do servidor (corrigida pela latência). O registro em si é sempre
// carimbado pelo servidor. A cada sincronização, o aparelho informa também o
// estado da câmera, que o gestor vê em "Aparelhos de ponto".
export function useSincronizacao(camera: DiagnosticoCamera) {
  const [info, setInfo] = useState<InfoAparelho | null>(() => JSON.parse(lerLocal(CHAVE_INFO) ?? 'null'))
  const [deslocamento, setDeslocamento] = useState(0)
  const [conectado, setConectado] = useState(() => navigator.onLine)
  const [desativado, setDesativado] = useState(false)
  const cameraRef = useRef(camera)
  useEffect(() => {
    cameraRef.current = camera
  })

  const sincronizar = useCallback(async () => {
    const inicio = Date.now()
    const inicioContinuo = performance.now()
    try {
      const resposta = await api.sincronizarDispositivo({ camera: cameraRef.current })
      const fim = Date.now()
      const fimContinuo = performance.now()
      setConectado(true)
      setDeslocamento(resposta.agora - (inicio + fim) / 2)
      if (!resposta.ativo) {
        setDesativado(true)
        return
      }
      // Âncora de horário para as batidas sem internet, no meio da ida e volta.
      if (resposta.semInternet) guardarReferencia(resposta.semInternet, (inicio + fim) / 2, (inicioContinuo + fimContinuo) / 2)
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

  // A câmera ficou pronta ou deu problema: o painel fica sabendo em seguida.
  const situacaoCamera = camera.estado === 'iniciando' ? null : `${camera.estado}|${camera.codigo ?? ''}`
  useEffect(() => {
    if (!situacaoCamera) return
    const id = setTimeout(() => void sincronizar(), AVISAR_CAMERA_MS)
    return () => clearTimeout(id)
  }, [situacaoCamera, sincronizar])

  return { info, deslocamento, conectado, desativado, setConectado }
}

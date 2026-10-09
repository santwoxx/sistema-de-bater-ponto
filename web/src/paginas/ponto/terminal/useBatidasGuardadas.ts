import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from '../../../api'
import { contarGuardadas, enviarGuardadas, guardarBatida, type ResumoEnvio } from './semInternet'

/** Enquanto houver batidas guardadas, tenta enviar a cada minuto. */
const TENTAR_A_CADA_MS = 60_000
const AVISO_MS = 2 * 60_000

export interface AvisoDeEnvio {
  tipo: 'ok' | 'alerta'
  texto: string
}

export function avisoDoEnvio({ enviadas, recusadas }: ResumoEnvio): AvisoDeEnvio | null {
  if (recusadas.length > 0) {
    const motivos = [...new Set(recusadas.map((motivo) => motivo.replace(/\.$/, '')))].join('; ')
    const quantas = recusadas.length === 1 ? '1 batida feita sem internet foi recusada' : `${recusadas.length} batidas feitas sem internet foram recusadas`
    return { tipo: 'alerta', texto: `${quantas} (${motivos}). O gestor foi avisado no painel.` }
  }
  if (enviadas === 0) return null
  return { tipo: 'ok', texto: enviadas === 1 ? 'Internet de volta: a batida guardada foi enviada.' : `Internet de volta: as ${enviadas} batidas guardadas foram enviadas.` }
}

/**
 * Batidas feitas sem internet: quantas estão guardadas, o envio automático
 * quando a conexão volta e o aviso do resultado na tela do ponto.
 */
export function useBatidasGuardadas(conectado: boolean, aoConectar: () => void) {
  const [pendentes, setPendentes] = useState(0)
  const [enviando, setEnviando] = useState(false)
  const [aviso, setAviso] = useState<AvisoDeEnvio | null>(null)
  const aoConectarRef = useRef(aoConectar)
  useEffect(() => {
    aoConectarRef.current = aoConectar
  })

  const contar = useCallback(async () => {
    const guardadas = await contarGuardadas().catch(() => 0)
    setPendentes(guardadas)
    return guardadas
  }, [])

  const enviar = useCallback(async () => {
    if ((await contar()) === 0) return
    setEnviando(true)
    try {
      const resumo = await enviarGuardadas((pacote) => api.registrarPontoGuardado({ pacote }))
      if (resumo.enviadas > 0 || resumo.recusadas.length > 0) aoConectarRef.current()
      const novo = avisoDoEnvio(resumo)
      if (novo) setAviso(novo)
    } catch {
      // Sem acesso ao armazenamento: tenta de novo na próxima vez.
    } finally {
      setEnviando(false)
      await contar()
    }
  }, [contar])

  // Ao abrir, quando a internet volta e, havendo batidas guardadas, a cada minuto.
  useEffect(() => {
    // Lê o armazenamento local; o estado só muda quando ele responde.
    // oxlint-disable-next-line react/set-state-in-effect
    if (conectado) void enviar()
    else void contar()
  }, [conectado, enviar, contar])
  useEffect(() => {
    if (pendentes === 0) return
    const id = setInterval(() => void enviar(), TENTAR_A_CADA_MS)
    return () => clearInterval(id)
  }, [pendentes, enviar])
  useEffect(() => {
    if (!aviso) return
    const id = setTimeout(() => setAviso(null), AVISO_MS)
    return () => clearTimeout(id)
  }, [aviso])

  const guardar = useCallback(
    async (batida: Parameters<typeof guardarBatida>[0]) => {
      const resultado = await guardarBatida(batida)
      await contar()
      return resultado
    },
    [contar],
  )

  return { pendentes, enviando, aviso, guardar }
}

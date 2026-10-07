import { useCallback, useEffect, useRef, useState } from 'react'

export interface Captura {
  /** Foto enviada como comprovante (até 720 px no maior lado). */
  foto: string
  /** Recorte quadrado pequeno, exibido nas listas do painel sem baixar a foto inteira. */
  miniatura: string
}

function quadro(video: HTMLVideoElement, ladoMaximo: number, qualidade: number): string {
  const escala = Math.min(1, ladoMaximo / Math.max(video.videoWidth, video.videoHeight))
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(video.videoWidth * escala)
  canvas.height = Math.round(video.videoHeight * escala)
  canvas.getContext('2d')!.drawImage(video, 0, 0, canvas.width, canvas.height)
  return canvas.toDataURL('image/jpeg', qualidade)
}

function quadroQuadrado(video: HTMLVideoElement, lado: number, qualidade: number): string {
  const corte = Math.min(video.videoWidth, video.videoHeight)
  const canvas = document.createElement('canvas')
  canvas.width = lado
  canvas.height = lado
  canvas
    .getContext('2d')!
    .drawImage(video, (video.videoWidth - corte) / 2, (video.videoHeight - corte) / 2, corte, corte, 0, 0, lado, lado)
  return canvas.toDataURL('image/jpeg', qualidade)
}

function mensagemCamera(erro: unknown): string {
  switch ((erro as DOMException | null)?.name) {
    case 'NotAllowedError':
      return 'O acesso à câmera foi negado. Libere a câmera para este site nas configurações do navegador.'
    case 'NotFoundError':
    case 'OverconstrainedError':
      return 'Nenhuma câmera encontrada neste aparelho.'
    case 'NotReadableError':
      return 'A câmera está sendo usada por outro aplicativo.'
    default:
      return 'Não foi possível acessar a câmera.'
  }
}

export type EstadoCamera = 'iniciando' | 'pronta' | 'erro'

export function useCamera() {
  const videoRef = useRef<HTMLVideoElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  // Cada tentativa de abrir a câmera recebe um número; respostas atrasadas de
  // tentativas antigas são descartadas (e a câmera delas é desligada).
  const tentativaRef = useRef(0)
  const [estado, setEstado] = useState<EstadoCamera>('iniciando')
  const [erro, setErro] = useState('')

  const parar = useCallback(() => {
    tentativaRef.current++
    streamRef.current?.getTracks().forEach((t) => t.stop())
    streamRef.current = null
  }, [])

  const iniciar = useCallback(async () => {
    parar()
    const tentativa = tentativaRef.current
    setEstado('iniciando')
    setErro('')
    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
      setEstado('erro')
      setErro('A câmera só funciona em conexão segura (https) e em navegador atualizado.')
      return
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 } },
      })
      if (tentativa !== tentativaRef.current) {
        stream.getTracks().forEach((t) => t.stop())
        return
      }
      streamRef.current = stream
      const video = videoRef.current
      if (video) {
        video.srcObject = stream
        await video.play().catch(() => undefined)
      }
      stream.getVideoTracks()[0]?.addEventListener('ended', () => {
        setEstado('erro')
        setErro('A câmera foi desconectada.')
      })
      setEstado('pronta')
    } catch (e) {
      if (tentativa !== tentativaRef.current) return
      setEstado('erro')
      setErro(mensagemCamera(e))
    }
  }, [parar])

  useEffect(() => {
    // Sincroniza com um sistema externo; o estado só muda quando ele responde.
    // oxlint-disable-next-line react/set-state-in-effect
    void iniciar()
    const aoVoltar = () => {
      if (document.visibilityState === 'visible' && !streamRef.current?.active) void iniciar()
    }
    document.addEventListener('visibilitychange', aoVoltar)
    return () => {
      document.removeEventListener('visibilitychange', aoVoltar)
      parar()
    }
  }, [iniciar, parar])

  const capturar = useCallback((): Captura | null => {
    const video = videoRef.current
    if (!video || video.readyState < 2 || !video.videoWidth) return null
    return { foto: quadro(video, 720, 0.8), miniatura: quadroQuadrado(video, 96, 0.7) }
  }, [])

  return { videoRef, estado, erro, iniciar, capturar }
}

/** Mantém a tela do aparelho acesa enquanto o ponto estiver aberto. */
export function useTelaSempreAcesa() {
  useEffect(() => {
    let trava: WakeLockSentinel | null = null
    const pedir = async () => {
      try {
        if ('wakeLock' in navigator && document.visibilityState === 'visible') trava = await navigator.wakeLock.request('screen')
      } catch {
        // navegador sem suporte: a tela pode apagar conforme a configuração do aparelho
      }
    }
    void pedir()
    const aoVoltar = () => {
      if (document.visibilityState === 'visible') void pedir()
    }
    document.addEventListener('visibilitychange', aoVoltar)
    return () => {
      document.removeEventListener('visibilitychange', aoVoltar)
      void trava?.release().catch(() => undefined)
    }
  }, [])
}

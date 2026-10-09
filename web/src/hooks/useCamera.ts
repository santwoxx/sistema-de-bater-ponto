import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { mensagemDaCamera, navegadorInterno, nomeDoErro, plataformaDe, tentarOutraConfiguracao, type CodigoCamera } from '../lib/camera'

// Câmera do aparelho de ponto. Feita para celulares e tablets de todo tipo:
//  - tenta configurações cada vez mais simples (há aparelhos que não abrem a
//    câmera frontal em HD e abrem em resolução menor);
//  - se o pedido de permissão não aparecer (o Chrome às vezes o deixa discreto
//    na barra de endereço) ou se o aparelho bloquear o vídeo, pede um toque em
//    "Ligar a câmera": com o toque, o navegador mostra o pedido de verdade;
//  - religa sozinha quando a câmera cai, quando a tela volta a aparecer e
//    quando a pessoa libera a câmera nas configurações do navegador;
//  - fora da tela, solta a câmera (outros aplicativos podem precisar dela);
//  - informa o estado ao painel (diagnóstico), para o gestor ver o problema.

export interface Captura {
  /** Foto enviada como comprovante (até 720 px no maior lado). */
  foto: string
  /** Recorte quadrado pequeno, exibido nas listas do painel sem baixar a foto inteira. */
  miniatura: string
}

export type EstadoCamera = 'iniciando' | 'pronta' | 'toque' | 'erro'
export type PermissaoCamera = PermissionState | 'desconhecida'

/** O que o aparelho informa ao painel sobre a câmera (ver sincronizarDispositivo). */
export interface DiagnosticoCamera {
  estado: EstadoCamera
  codigo: string | null
  detalhe: string | null
  permissao: PermissaoCamera
  resolucao: string | null
}

// Da melhor para a mais simples.
const CONFIGURACOES: MediaTrackConstraints[] = [
  { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 } },
  { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } },
  { facingMode: 'user' },
  {},
]
const ESPERA_PERMISSAO_MS = 4_000
const ESPERA_IMAGEM_MS = 5_000
const VIGIA_MS = 5_000
/** Religa sozinha no máximo 3 vezes por minuto; depois, pede um toque. */
const MAX_RELIGAMENTOS = 3

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

const temImagem = (video: HTMLVideoElement) => video.videoWidth > 0 && video.readyState >= 2

/** Espera a primeira imagem da câmera chegar ao vídeo (ou o tempo acabar). */
function esperarImagem(video: HTMLVideoElement, ms: number): Promise<boolean> {
  if (temImagem(video)) return Promise.resolve(true)
  return new Promise((resolve) => {
    const terminar = (ok: boolean) => {
      clearTimeout(limite)
      video.removeEventListener('loadeddata', conferir)
      video.removeEventListener('resize', conferir)
      resolve(ok)
    }
    const conferir = () => {
      if (temImagem(video)) terminar(true)
    }
    const limite = setTimeout(() => terminar(temImagem(video)), ms)
    video.addEventListener('loadeddata', conferir)
    video.addEventListener('resize', conferir)
  })
}

export function useCamera() {
  const videoRef = useRef<HTMLVideoElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  // Cada tentativa de abrir a câmera recebe um número; respostas atrasadas de
  // tentativas antigas são descartadas (e a câmera delas é desligada).
  const tentativaRef = useRef(0)
  const religamentosRef = useRef<number[]>([])
  /** A câmera foi solta porque a tela saiu de vista: volta quando ela reaparecer. */
  const pausadaRef = useRef(false)
  const [estado, setEstado] = useState<EstadoCamera>('iniciando')
  const [codigo, setCodigo] = useState<CodigoCamera | null>(null)
  const [detalhe, setDetalhe] = useState<string | null>(null)
  const [permissao, setPermissao] = useState<PermissaoCamera>('desconhecida')
  const [resolucao, setResolucao] = useState<string | null>(null)
  const estadoRef = useRef(estado)
  const codigoRef = useRef(codigo)
  useEffect(() => {
    estadoRef.current = estado
    codigoRef.current = codigo
  })
  const ambiente = useMemo(
    () => ({ plataforma: plataformaDe(navigator.userAgent, navigator.maxTouchPoints), interno: navegadorInterno(navigator.userAgent) }),
    [],
  )

  const mudar = useCallback((novo: EstadoCamera, novoCodigo: CodigoCamera | null = null, novoDetalhe: string | null = null) => {
    estadoRef.current = novo
    codigoRef.current = novoCodigo
    setEstado(novo)
    setCodigo(novoCodigo)
    setDetalhe(novoDetalhe)
  }, [])

  const parar = useCallback(() => {
    tentativaRef.current++
    streamRef.current?.getTracks().forEach((t) => t.stop())
    streamRef.current = null
  }, [])

  /** Põe a câmera no vídeo e espera a imagem chegar. */
  const mostrar = useCallback(async (stream: MediaStream, tentativa: number): Promise<'pronta' | 'toque' | 'semImagem' | 'cancelada'> => {
    const video = videoRef.current
    if (!video || tentativa !== tentativaRef.current) return 'cancelada'
    // O iPhone só toca o vídeo dentro da página e sem som com estes atributos.
    video.muted = true
    video.setAttribute('muted', '')
    video.setAttribute('playsinline', '')
    video.srcObject = stream
    try {
      await video.play()
    } catch (e) {
      if (tentativa !== tentativaRef.current) return 'cancelada'
      // Vídeo bloqueado (ex.: iPhone em economia de energia): falta só um toque.
      if (nomeDoErro(e) === 'NotAllowedError') return 'toque'
    }
    const chegou = await esperarImagem(video, ESPERA_IMAGEM_MS)
    if (tentativa !== tentativaRef.current) return 'cancelada'
    if (!chegou) return 'semImagem'
    setResolucao(`${video.videoWidth}x${video.videoHeight}`)
    return 'pronta'
  }, [])

  const religarSozinhaRef = useRef<(motivo: CodigoCamera) => void>(() => undefined)

  const iniciar = useCallback(async () => {
    parar()
    pausadaRef.current = false
    const tentativa = tentativaRef.current
    const atual = () => tentativa === tentativaRef.current
    mudar('iniciando')
    if (!window.isSecureContext) return mudar('erro', 'Inseguro')
    if (!navigator.mediaDevices?.getUserMedia) return mudar('erro', 'SemSuporte')

    // Sem resposta em alguns segundos: o pedido de permissão pode estar escondido
    // na barra de endereço. Com um toque, o navegador mostra o pedido de verdade.
    const aviso = setTimeout(() => {
      if (atual() && estadoRef.current === 'iniciando') mudar('toque', 'Aguardando')
    }, ESPERA_PERMISSAO_MS)
    try {
      let ultimoErro: unknown = null
      for (const configuracao of CONFIGURACOES) {
        let stream: MediaStream
        try {
          stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: configuracao })
        } catch (e) {
          if (!atual()) return
          ultimoErro = e
          if (tentarOutraConfiguracao(nomeDoErro(e))) continue
          break
        }
        if (!atual()) {
          stream.getTracks().forEach((t) => t.stop())
          return
        }
        clearTimeout(aviso)
        streamRef.current = stream
        const resultado = await mostrar(stream, tentativa)
        if (resultado === 'cancelada') return
        if (resultado === 'semImagem') {
          stream.getTracks().forEach((t) => t.stop())
          streamRef.current = null
          ultimoErro = { name: 'SemImagem' }
          continue
        }
        stream.getVideoTracks()[0]?.addEventListener('ended', () => {
          if (atual()) religarSozinhaRef.current('Desconectada')
        })
        if (resultado === 'toque') mudar('toque', 'ReproducaoBloqueada')
        else mudar('pronta')
        return
      }
      if (atual()) mudar('erro', nomeDoErro(ultimoErro), (ultimoErro as { message?: string } | null)?.message?.slice(0, 160) || null)
    } finally {
      clearTimeout(aviso)
    }
  }, [parar, mudar, mostrar])

  const iniciarRef = useRef(iniciar)
  useEffect(() => {
    iniciarRef.current = iniciar
  })

  // Religa sozinha (câmera caiu, imagem sumiu), sem entrar em ciclo: depois de
  // algumas vezes seguidas, para e pede um toque.
  const religarSozinha = useCallback(
    (motivo: CodigoCamera) => {
      if (document.visibilityState !== 'visible') {
        pausadaRef.current = true
        return
      }
      const agora = Date.now()
      religamentosRef.current = [...religamentosRef.current.filter((t) => agora - t < 60_000), agora]
      if (religamentosRef.current.length > MAX_RELIGAMENTOS) {
        parar()
        mudar('erro', motivo)
        return
      }
      void iniciar()
    },
    [iniciar, parar, mudar],
  )
  useEffect(() => {
    religarSozinhaRef.current = religarSozinha
  })

  /** Toque na área da câmera: "Ligar a câmera" ou "Tentar novamente". */
  const tocar = useCallback(() => {
    const video = videoRef.current
    // Só faltava o toque para o vídeo aparecer: não precisa abrir a câmera de novo.
    if (codigoRef.current === 'ReproducaoBloqueada' && video && streamRef.current?.active) {
      const tentativa = tentativaRef.current
      void video.play().then(
        async () => {
          if (tentativa !== tentativaRef.current) return
          if (await esperarImagem(video, ESPERA_IMAGEM_MS)) {
            setResolucao(`${video.videoWidth}x${video.videoHeight}`)
            mudar('pronta')
          } else {
            void iniciar()
          }
        },
        () => mudar('toque', 'ReproducaoBloqueada'),
      )
      return
    }
    religamentosRef.current = []
    void iniciar()
  }, [iniciar, mudar])

  // Liga ao abrir a tela; desliga ao sair.
  useEffect(() => {
    // Sincroniza com um sistema externo; o estado só muda quando ele responde.
    // oxlint-disable-next-line react/set-state-in-effect
    void iniciar()
    return () => parar()
  }, [iniciar, parar])

  // Tela fora de vista: solta a câmera. De volta: confere e religa se preciso.
  useEffect(() => {
    const aoMudarVisibilidade = () => {
      if (document.visibilityState === 'hidden') {
        if (estadoRef.current === 'pronta') {
          parar()
          pausadaRef.current = true
        }
        return
      }
      const video = videoRef.current
      const trilha = streamRef.current?.getVideoTracks()[0]
      const viva = Boolean(video && trilha?.readyState === 'live' && !trilha.muted && temImagem(video))
      if (estadoRef.current === 'pronta' && viva) {
        if (video!.paused) void video!.play().catch(() => mudar('toque', 'ReproducaoBloqueada'))
        return
      }
      // Bloqueio de permissão só sai quando a pessoa libera (ver o efeito da permissão).
      if (['NotAllowedError', 'SecurityError', 'SemSuporte', 'Inseguro'].includes(codigoRef.current ?? '')) return
      if (pausadaRef.current || estadoRef.current === 'pronta' || estadoRef.current === 'erro') {
        religamentosRef.current = []
        void iniciar()
      }
    }
    document.addEventListener('visibilitychange', aoMudarVisibilidade)
    window.addEventListener('pageshow', aoMudarVisibilidade)
    return () => {
      document.removeEventListener('visibilitychange', aoMudarVisibilidade)
      window.removeEventListener('pageshow', aoMudarVisibilidade)
    }
  }, [iniciar, parar, mudar])

  // Vigia: vídeo parado ou sem imagem por mais de uma checagem: religa.
  useEffect(() => {
    let semImagem = 0
    const id = setInterval(() => {
      if (document.visibilityState !== 'visible' || estadoRef.current !== 'pronta') return
      const video = videoRef.current
      const trilha = streamRef.current?.getVideoTracks()[0]
      if (!video || !trilha || trilha.readyState !== 'live') {
        religarSozinhaRef.current('Desconectada')
        return
      }
      if (video.paused) {
        void video.play().catch(() => mudar('toque', 'ReproducaoBloqueada'))
        return
      }
      semImagem = temImagem(video) ? 0 : semImagem + 1
      if (semImagem >= 2) {
        semImagem = 0
        religarSozinhaRef.current('SemImagem')
      }
    }, VIGIA_MS)
    return () => clearInterval(id)
  }, [mudar])

  // Permissão da câmera: quando a pessoa libera nas configurações do navegador,
  // a câmera liga sozinha (onde o navegador informa a permissão).
  useEffect(() => {
    let status: PermissionStatus | null = null
    let ativo = true
    navigator.permissions
      ?.query({ name: 'camera' as PermissionName })
      .then((s) => {
        if (!ativo) return
        status = s
        setPermissao(s.state)
        s.onchange = () => {
          setPermissao(s.state)
          if (s.state === 'granted' && estadoRef.current !== 'pronta') {
            religamentosRef.current = []
            void iniciarRef.current()
          }
        }
      })
      .catch(() => undefined)
    return () => {
      ativo = false
      if (status) status.onchange = null
    }
  }, [])

  const capturar = useCallback((): Captura | null => {
    const video = videoRef.current
    if (!video || !temImagem(video)) {
      // Sem imagem na hora da foto: religa para a próxima tentativa.
      if (estadoRef.current === 'pronta') religarSozinhaRef.current('SemImagem')
      return null
    }
    return { foto: quadro(video, 720, 0.8), miniatura: quadroQuadrado(video, 96, 0.7) }
  }, [])

  const mensagem = estado === 'erro' || estado === 'toque' ? mensagemDaCamera(codigo ?? '', ambiente.plataforma, ambiente.interno) : ''
  const diagnostico = useMemo<DiagnosticoCamera>(
    () => ({ estado, codigo, detalhe, permissao, resolucao }),
    [estado, codigo, detalhe, permissao, resolucao],
  )
  return { videoRef, estado, mensagem, codigo, interno: ambiente.interno, tocar, capturar, diagnostico }
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

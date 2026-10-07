import { Camera, LoaderCircle } from 'lucide-react'
import type { RefObject } from 'react'
import type { EstadoCamera } from '../../../hooks/useCamera'

/** Câmera ao vivo com a moldura do rosto, a contagem antes da foto e o aviso de espera. */
export default function CameraPonto({
  videoRef,
  estado,
  erro,
  aoTentarDeNovo,
  contagem,
  aguardando,
}: {
  videoRef: RefObject<HTMLVideoElement | null>
  estado: EstadoCamera
  erro: string
  aoTentarDeNovo: () => void
  /** Número da contagem regressiva (só durante a foto). */
  contagem: number | null
  /** Texto de espera enquanto fala com o servidor. */
  aguardando: string | null
}) {
  return (
    <section className="terminal-camera">
      <video ref={videoRef} autoPlay playsInline muted />
      <div className="moldura-rosto" aria-hidden />
      {estado !== 'pronta' && (
        <div className="camera-aviso">
          {estado === 'iniciando' ? (
            <>
              <LoaderCircle className="girando" aria-hidden /> Ligando a câmera...
            </>
          ) : (
            <>
              <Camera aria-hidden />
              <p>{erro}</p>
              <button type="button" className="botao" onClick={aoTentarDeNovo}>
                Tentar novamente
              </button>
            </>
          )}
        </div>
      )}
      {contagem !== null && (
        <div className="contagem" aria-live="assertive">
          <span key={contagem}>{contagem}</span>
          <p>Olhe para a câmera</p>
        </div>
      )}
      {aguardando && (
        <div className="camera-aviso">
          <LoaderCircle className="girando" aria-hidden /> {aguardando}
        </div>
      )}
    </section>
  )
}

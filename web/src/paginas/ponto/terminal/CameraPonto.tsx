import { Camera, CameraOff, Copy, LoaderCircle } from 'lucide-react'
import { useState, type RefObject } from 'react'
import type { EstadoCamera } from '../../../hooks/useCamera'

/** Câmera ao vivo com a moldura do rosto, a contagem antes da foto e os avisos (com o que fazer). */
export default function CameraPonto({
  videoRef,
  estado,
  mensagem,
  codigo,
  interno,
  aoTocar,
  contagem,
  aguardando,
}: {
  videoRef: RefObject<HTMLVideoElement | null>
  estado: EstadoCamera
  /** O que dizer quando a câmera precisa de um toque ou deu problema. */
  mensagem: string
  /** Código técnico do problema, para o suporte. */
  codigo: string | null
  /** Nome do aplicativo, se o ponto foi aberto no navegador interno dele. */
  interno: string | null
  /** "Ligar a câmera" ou "Tentar novamente". */
  aoTocar: () => void
  /** Número da contagem regressiva (só durante a foto). */
  contagem: number | null
  /** Texto de espera enquanto fala com o servidor. */
  aguardando: string | null
}) {
  const [copiado, setCopiado] = useState(false)

  async function copiarEndereco() {
    try {
      await navigator.clipboard.writeText(window.location.href)
      setCopiado(true)
    } catch {
      setCopiado(false)
    }
  }

  return (
    <section className="terminal-camera">
      <video ref={videoRef} autoPlay playsInline muted />
      <div className="moldura-rosto" aria-hidden />
      {estado === 'iniciando' && (
        <div className="camera-aviso">
          <LoaderCircle className="girando" aria-hidden /> Ligando a câmera...
        </div>
      )}
      {estado === 'toque' && (
        <div className="camera-aviso" role="status">
          <button type="button" className="botao primario camera-ligar" onClick={aoTocar}>
            <Camera size={20} aria-hidden /> Ligar a câmera
          </button>
          <p>{mensagem}</p>
        </div>
      )}
      {estado === 'erro' && (
        <div className="camera-aviso" role="alert">
          <CameraOff aria-hidden />
          <div className="camera-acoes">
            <button type="button" className="botao" onClick={aoTocar}>
              Tentar novamente
            </button>
            {interno && (
              <button type="button" className="botao" onClick={() => void copiarEndereco()}>
                <Copy size={16} aria-hidden /> {copiado ? 'Endereço copiado' : 'Copiar endereço'}
              </button>
            )}
          </div>
          <p>{mensagem}</p>
          {interno && <small className="camera-endereco">{window.location.href}</small>}
          {codigo && <small className="camera-codigo">Código: {codigo}</small>}
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

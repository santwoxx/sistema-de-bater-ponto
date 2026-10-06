import { X } from 'lucide-react'
import { useEffect, useRef, type FormEvent, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

interface Props {
  titulo: string
  aoFechar: () => void
  children: ReactNode
  rodape?: ReactNode
  /** Quando informado, o conteúdo vira um formulário (Enter envia). */
  aoEnviar?: () => void
  largura?: 'pequena' | 'media' | 'grande'
}

export default function Modal({ titulo, aoFechar, children, rodape, aoEnviar, largura = 'media' }: Props) {
  const fecharRef = useRef(aoFechar)
  useEffect(() => {
    fecharRef.current = aoFechar
  })

  useEffect(() => {
    const tecla = (e: KeyboardEvent) => {
      if (e.key === 'Escape') fecharRef.current()
    }
    document.addEventListener('keydown', tecla)
    const overflowAnterior = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', tecla)
      document.body.style.overflow = overflowAnterior
    }
  }, [])

  const conteudo = (
    <>
      <div className="modal-corpo">{children}</div>
      {rodape && <footer className="modal-rodape">{rodape}</footer>}
    </>
  )

  return createPortal(
    <div
      className="modal-fundo"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) aoFechar()
      }}
    >
      <div className={`modal modal-${largura}`} role="dialog" aria-modal="true" aria-labelledby="modal-titulo">
        <header className="modal-cabecalho">
          <h2 id="modal-titulo">{titulo}</h2>
          <button type="button" className="botao-icone" onClick={aoFechar} aria-label="Fechar">
            <X size={20} />
          </button>
        </header>
        {aoEnviar ? (
          <form
            className="modal-formulario"
            noValidate
            onSubmit={(e: FormEvent) => {
              e.preventDefault()
              aoEnviar()
            }}
          >
            {conteudo}
          </form>
        ) : (
          conteudo
        )}
      </div>
    </div>,
    document.body,
  )
}

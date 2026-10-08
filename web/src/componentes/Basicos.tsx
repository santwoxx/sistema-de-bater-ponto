import { CircleAlert, CircleCheck, Info, LoaderCircle, TriangleAlert, type LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'

export function Carregando({ texto = 'Carregando...', tela = false }: { texto?: string; tela?: boolean }) {
  return (
    <div className={tela ? 'carregando carregando-tela' : 'carregando'} role="status">
      <LoaderCircle className="girando" size={tela ? 32 : 20} aria-hidden />
      <span>{texto}</span>
    </div>
  )
}

const ICONES_AVISO = { info: Info, erro: CircleAlert, sucesso: CircleCheck, alerta: TriangleAlert }

export function Aviso({ tipo = 'info', children }: { tipo?: keyof typeof ICONES_AVISO; children: ReactNode }) {
  const Icone = ICONES_AVISO[tipo]
  return (
    <div className={`aviso aviso-${tipo}`} role={tipo === 'erro' ? 'alert' : undefined}>
      <Icone size={18} aria-hidden />
      <div>{children}</div>
    </div>
  )
}

export function Vazio({ icone: Icone, titulo, children }: { icone: LucideIcon; titulo: string; children?: ReactNode }) {
  return (
    <div className="vazio">
      <Icone size={36} aria-hidden />
      <strong>{titulo}</strong>
      {children && <div className="vazio-texto">{children}</div>}
    </div>
  )
}

export function Campo({
  rotulo,
  ajuda,
  children,
  className = '',
}: {
  rotulo: string
  ajuda?: ReactNode
  children: ReactNode
  className?: string
}) {
  return (
    <label className={`campo ${className}`}>
      <span className="campo-rotulo">{rotulo}</span>
      {children}
      {ajuda && <small className="campo-ajuda">{ajuda}</small>}
    </label>
  )
}

export function Selo({ cor = 'cinza', children }: { cor?: 'verde' | 'azul' | 'cinza' | 'amarelo' | 'vermelho'; children: ReactNode }) {
  return <span className={`selo selo-${cor}`}>{children}</span>
}

export function CabecalhoPagina({ titulo, descricao, acoes }: { titulo: string; descricao?: ReactNode; acoes?: ReactNode }) {
  return (
    <div className="cabecalho-pagina">
      <div>
        <h1>{titulo}</h1>
        {descricao && <p>{descricao}</p>}
      </div>
      {acoes && <div className="cabecalho-acoes">{acoes}</div>}
    </div>
  )
}

/** Botão do login com Google. O logotipo é desenhado aqui: nada vem de fora antes do clique. */
export function BotaoGoogle({ texto = 'Entrar com Google', aoClicar, desativado }: { texto?: string; aoClicar: () => void; desativado?: boolean }) {
  return (
    <button type="button" className="botao grande botao-google" onClick={aoClicar} disabled={desativado}>
      <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden>
        <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
        <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
        <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
        <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
      </svg>
      {texto}
    </button>
  )
}

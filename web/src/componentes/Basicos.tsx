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

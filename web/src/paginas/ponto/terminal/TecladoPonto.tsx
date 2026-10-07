import { Check, ClockAlert, Delete, FileSignature, KeyRound } from 'lucide-react'
import type { Modo } from './tipos'

const TECLAS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'apagar', '0', 'ok'] as const

/** O que o visor mostra: a matrícula digitada ou os pontos do PIN. */
export type Visor = { tipo: 'matricula'; valor: string } | { tipo: 'pin'; legenda: string; digitos: number }

/** Atalhos da tela inicial ou o botão de cancelar (fora do modo ponto). */
export type Rodape = 'atalhos' | 'cancelar' | null

const ATALHOS: Array<{ modo: Exclude<Modo, 'ponto'>; rotulo: string; Icone: typeof ClockAlert }> = [
  { modo: 'solicitacao', rotulo: 'Esqueci de bater o ponto', Icone: ClockAlert },
  { modo: 'assinatura', rotulo: 'Assinar meu espelho', Icone: FileSignature },
  { modo: 'trocarPin', rotulo: 'Trocar meu PIN', Icone: KeyRound },
]

/** Título, visor, teclado numérico, atalhos e instrução do aparelho. */
export default function TecladoPonto({
  titulo,
  visor,
  podeConfirmar,
  bloqueado,
  aoTeclar,
  rodape,
  aoCancelar,
  aoEscolherModo,
  instrucao,
  instrucaoComErro,
}: {
  titulo: string
  visor: Visor
  podeConfirmar: boolean
  /** Durante a foto e o envio, nada pode ser digitado. */
  bloqueado: boolean
  aoTeclar: (tecla: string) => void
  rodape: Rodape
  aoCancelar: () => void
  aoEscolherModo: (modo: Exclude<Modo, 'ponto'>) => void
  instrucao: string
  instrucaoComErro: boolean
}) {
  return (
    <>
      <h1>{titulo}</h1>
      <div className="visor" aria-live="polite">
        {visor.tipo === 'pin' ? (
          <>
            <small>{visor.legenda}</small>
            <div className="pontos-pin">
              {Array.from({ length: Math.max(4, visor.digitos) }, (_, i) => (
                <span key={i} className={i < visor.digitos ? 'cheio' : ''} />
              ))}
            </div>
          </>
        ) : (
          <span className="visor-numero">{visor.valor || <span className="visor-dica">0000</span>}</span>
        )}
      </div>
      <div className="teclado">
        {TECLAS.map((t) => (
          <button
            key={t}
            type="button"
            className={`tecla ${t === 'ok' ? 'tecla-ok' : ''} ${t === 'apagar' ? 'tecla-apagar' : ''}`}
            disabled={bloqueado || (t === 'ok' && !podeConfirmar)}
            onClick={() => aoTeclar(t)}
            aria-label={t === 'ok' ? 'Confirmar' : t === 'apagar' ? 'Apagar' : t}
          >
            {t === 'ok' ? <Check size={30} /> : t === 'apagar' ? <Delete size={28} /> : t}
          </button>
        ))}
      </div>
      {rodape === 'cancelar' && (
        <button type="button" className="terminal-link" onClick={aoCancelar} disabled={bloqueado}>
          Cancelar e voltar ao ponto
        </button>
      )}
      {rodape === 'atalhos' && (
        <div className="terminal-atalhos">
          {ATALHOS.map(({ modo, rotulo, Icone }) => (
            <button key={modo} type="button" className="terminal-esqueci" onClick={() => aoEscolherModo(modo)}>
              <Icone size={20} aria-hidden /> {rotulo}
            </button>
          ))}
        </div>
      )}
      <p className={`terminal-instrucao ${instrucaoComErro ? 'terminal-erro' : ''}`}>{instrucao}</p>
    </>
  )
}

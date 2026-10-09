import { Check, Delete } from 'lucide-react'
import { TAMANHO_PIN } from '../../../lib/pin'
import { cpfNoVisor } from './textos'

const TECLAS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'apagar', '0', 'ok'] as const

/** O que o visor mostra: o CPF digitado ou os pontos do PIN (e, acima, quem é). */
export type Visor = { tipo: 'cpf'; digitos: string } | { tipo: 'pin'; legenda: string | null; digitos: number }

/** Título, visor, teclado numérico e instrução (ou o erro do que foi digitado) do aparelho. */
export default function TecladoPonto({
  titulo,
  visor,
  podeConfirmar,
  bloqueado,
  aoTeclar,
  instrucao,
  erro,
}: {
  titulo: string
  visor: Visor
  podeConfirmar: boolean
  /** Durante a foto e o envio, nada pode ser digitado. */
  bloqueado: boolean
  aoTeclar: (tecla: string) => void
  instrucao: string
  /** Problema no que foi digitado (ex.: CPF inválido): aparece no lugar da instrução. */
  erro: string
}) {
  return (
    <>
      <h1>{titulo}</h1>
      <div className="visor" aria-live="polite">
        {visor.tipo === 'cpf' ? (
          <span className="visor-numero">{visor.digitos ? cpfNoVisor(visor.digitos) : <span className="visor-dica">000.000.000-00</span>}</span>
        ) : (
          <>
            {visor.legenda && <small>{visor.legenda}</small>}
            <div className="pontos-pin" aria-label={`${visor.digitos} de ${TAMANHO_PIN} números do PIN digitados`}>
              {Array.from({ length: TAMANHO_PIN }, (_, i) => (
                <span key={i} className={i < visor.digitos ? 'cheio' : ''} />
              ))}
            </div>
          </>
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
      <p className={`terminal-instrucao${erro ? ' terminal-erro' : ''}`} role={erro ? 'alert' : undefined}>
        {erro || instrucao}
      </p>
    </>
  )
}

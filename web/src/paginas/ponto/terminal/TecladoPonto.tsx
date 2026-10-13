import { Check, Delete } from 'lucide-react'
import { TAMANHO_PIN } from '../../../lib/pin'

const TECLAS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'apagar', '0', 'ok'] as const

/** O que o visor mostra: os pontos do PIN e, acima, quem é (no celular pessoal). */
export type Visor = { legenda: string | null; digitos: number }

/** Título, visor, teclado numérico e instrução do aparelho. */
export default function TecladoPonto({
  titulo,
  visor,
  podeConfirmar,
  bloqueado,
  aoTeclar,
  instrucao,
}: {
  titulo: string
  visor: Visor
  podeConfirmar: boolean
  /** Durante a foto e o envio, nada pode ser digitado. */
  bloqueado: boolean
  aoTeclar: (tecla: string) => void
  instrucao: string
}) {
  return (
    <>
      <h1>{titulo}</h1>
      <div className="visor" aria-live="polite">
        {visor.legenda && <small>{visor.legenda}</small>}
        <div className="pontos-pin" aria-label={`${visor.digitos} de ${TAMANHO_PIN} números do PIN digitados`}>
          {Array.from({ length: TAMANHO_PIN }, (_, i) => (
            <span key={i} className={i < visor.digitos ? 'cheio' : ''} />
          ))}
        </div>
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
      <p className="terminal-instrucao">{instrucao}</p>
    </>
  )
}

import { Send } from 'lucide-react'
import type { FormEvent } from 'react'
import { somarDias } from '../../../lib/tempo'
import { MOTIVOS, OUTRO_MOTIVO, type Pedido } from './tipos'

/** "Esqueci de bater o ponto": dia, horário e motivo da marcação que faltou. */
export default function FormularioSolicitacao({
  matricula,
  pedido,
  aoMudar,
  hoje,
  erro,
  enviando,
  aoEnviar,
  aoCancelar,
}: {
  matricula: string
  pedido: Pedido
  aoMudar: (pedido: Pedido) => void
  /** Data de hoje no fuso da empresa (AAAA-MM-DD): limite do calendário. */
  hoje: string
  erro: string
  enviando: boolean
  aoEnviar: (e: FormEvent) => void
  aoCancelar: () => void
}) {
  return (
    <form className="terminal-formulario" onSubmit={aoEnviar}>
      <h1>Qual marcação ficou faltando?</h1>
      <p className="terminal-instrucao">Matrícula {matricula}. A marcação só passa a valer depois que o gestor aprovar.</p>
      <div className="terminal-campos">
        <label>
          Dia
          <input
            type="date"
            value={pedido.data}
            min={somarDias(hoje, -31)}
            max={hoje}
            onChange={(e) => aoMudar({ ...pedido, data: e.target.value })}
          />
        </label>
        <label>
          Horário
          <input type="time" value={pedido.hora} onChange={(e) => aoMudar({ ...pedido, hora: e.target.value })} />
        </label>
      </div>
      <label>
        Motivo
        <select value={pedido.motivo} onChange={(e) => aoMudar({ ...pedido, motivo: e.target.value })}>
          {MOTIVOS.map((m) => (
            <option key={m}>{m}</option>
          ))}
        </select>
      </label>
      {pedido.motivo === OUTRO_MOTIVO && (
        <label>
          Explique
          <input value={pedido.outroMotivo} maxLength={300} onChange={(e) => aoMudar({ ...pedido, outroMotivo: e.target.value })} autoFocus />
        </label>
      )}
      {erro && <p className="terminal-erro">{erro}</p>}
      <div className="terminal-botoes">
        <button type="button" className="tecla tecla-apagar" onClick={aoCancelar} disabled={enviando}>
          Cancelar
        </button>
        <button type="submit" className="tecla tecla-ok" disabled={enviando}>
          <Send size={22} aria-hidden /> Enviar pedido
        </button>
      </div>
    </form>
  )
}

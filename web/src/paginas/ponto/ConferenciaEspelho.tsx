import { useState } from 'react'
import type { EspelhoParaAssinar } from '../../api'
import { formatarData, minutosParaHHMM, nomeDiaCurto, nomeMes } from '../../lib/tempo'

// Tela do aparelho de ponto em que o funcionário confere o espelho do mês
// fechado e assina (concorda) ou contesta, explicando o que está errado.
export default function ConferenciaEspelho({
  espelho,
  restantes,
  ocupado,
  erro,
  aoAssinar,
  aoContestar,
  aoSair,
}: {
  espelho: EspelhoParaAssinar
  restantes: number
  ocupado: boolean
  erro: string
  aoAssinar: () => void
  aoContestar: (motivo: string) => void
  aoSair: () => void
}) {
  const [contestando, setContestando] = useState(false)
  const [motivo, setMotivo] = useState('')
  const [aviso, setAviso] = useState('')
  const totais = espelho.documento.totais
  const classeSaldo = (minutos: number) => (minutos < 0 ? 'negativo' : minutos > 0 ? 'positivo' : '')

  return (
    <div className="conferencia" role="dialog" aria-modal="true" aria-labelledby="conferencia-titulo">
      <header className="conferencia-topo">
        <div>
          <h2 id="conferencia-titulo">Espelho de ponto · {nomeMes(espelho.mes)}</h2>
          <p>
            {espelho.funcionario.nome} · Matrícula {espelho.funcionario.matricula} · {espelho.empresaNome}
          </p>
        </div>
        {restantes > 0 && <span className="conferencia-restantes">+{restantes} para assinar</span>}
      </header>

      <div className="conferencia-totais">
        <div>
          <strong>{minutosParaHHMM(totais.trabalhadoMin)}</strong>
          <span>trabalhadas</span>
        </div>
        <div>
          <strong>{minutosParaHHMM(totais.previstoMin)}</strong>
          <span>previstas</span>
        </div>
        <div>
          <strong className={classeSaldo(totais.saldoMin)}>{minutosParaHHMM(totais.saldoMin, true)}</strong>
          <span>saldo do mês</span>
        </div>
        <div>
          <strong>{totais.faltas}</strong>
          <span>faltas</span>
        </div>
      </div>

      <div className="conferencia-tabela">
        <table>
          <thead>
            <tr>
              <th>Dia</th>
              <th>Marcações</th>
              <th>Trabalhado</th>
              <th>Saldo</th>
              <th>Ocorrências</th>
            </tr>
          </thead>
          <tbody>
            {espelho.documento.dias.map((d) => (
              <tr key={d.data}>
                <td className="numeros sem-quebra">
                  {formatarData(d.data).slice(0, 5)} <small>{nomeDiaCurto(d.data)}</small>
                </td>
                <td className="numeros">{d.marcacoes.map((m) => `${m.hora}${m.manual ? '*' : ''}`).join('  ') || '—'}</td>
                <td className="numeros">{d.trabalhadoMin ? minutosParaHHMM(d.trabalhadoMin) : '—'}</td>
                <td className={`numeros ${classeSaldo(d.saldoMin ?? 0)}`}>{d.saldoMin === null ? '' : minutosParaHHMM(d.saldoMin, true)}</td>
                <td>{d.ocorrencias.join(' · ')}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <footer className="conferencia-rodape">
        {erro && <p className="terminal-erro">{erro}</p>}
        {contestando ? (
          <>
            <label className="conferencia-motivo">
              O que está errado?
              <textarea rows={2} value={motivo} onChange={(e) => setMotivo(e.target.value)} maxLength={500} autoFocus />
            </label>
            {aviso && <p className="terminal-erro">{aviso}</p>}
            <div className="conferencia-botoes">
              <button type="button" className="tecla tecla-apagar" onClick={() => setContestando(false)} disabled={ocupado}>
                Voltar
              </button>
              <button
                type="button"
                className="tecla tecla-contestar"
                disabled={ocupado}
                onClick={() => {
                  if (motivo.trim().length < 5) setAviso('Explique em poucas palavras o que está errado (mínimo de 5 letras).')
                  else aoContestar(motivo.trim())
                }}
              >
                {ocupado ? 'Enviando...' : 'Enviar contestação'}
              </button>
            </div>
          </>
        ) : (
          <>
            <p className="conferencia-termo">
              Ao assinar, você confirma que as marcações e os totais acima estão corretos. * = marcação incluída pelo gestor.
            </p>
            <div className="conferencia-botoes tres">
              <button type="button" className="tecla tecla-apagar" onClick={aoSair} disabled={ocupado}>
                Sair
              </button>
              <button type="button" className="tecla tecla-contestar" onClick={() => setContestando(true)} disabled={ocupado}>
                Não concordo
              </button>
              <button type="button" className="tecla tecla-ok" onClick={aoAssinar} disabled={ocupado}>
                {ocupado ? 'Assinando...' : 'Concordo e assino'}
              </button>
            </div>
          </>
        )}
      </footer>
    </div>
  )
}

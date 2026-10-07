import { Fingerprint, Maximize, Settings, WifiOff } from 'lucide-react'
import { dataPorExtenso, horaLocal } from '../../../lib/tempo'
import type { InfoAparelho } from './useSincronizacao'

/** Empresa e aparelho, relógio oficial e ações (tela cheia, configurações). */
export default function TopoTerminal({
  info,
  agora,
  fuso,
  conectado,
  aoAbrirConfiguracoes,
}: {
  info: InfoAparelho | null
  agora: Date
  fuso: string
  conectado: boolean
  aoAbrirConfiguracoes: () => void
}) {
  return (
    <>
      <header className="terminal-topo">
        <div className="terminal-empresa">
          <Fingerprint size={28} aria-hidden />
          <div>
            <strong>{info?.empresa.nome ?? 'Ponto'}</strong>
            <small>{info?.dispositivo.nome ?? ''}</small>
          </div>
        </div>
        <div className="terminal-relogio">
          <strong>{horaLocal(agora, fuso)}</strong>
          <span>{dataPorExtenso(agora, fuso)}</span>
        </div>
        <div className="terminal-acoes">
          {!conectado && (
            <span className="terminal-offline">
              <WifiOff size={16} aria-hidden /> Sem internet
            </span>
          )}
          {document.fullscreenEnabled && !document.fullscreenElement && (
            <button
              type="button"
              className="botao-icone"
              onClick={() => void document.documentElement.requestFullscreen().catch(() => undefined)}
              aria-label="Tela cheia"
            >
              <Maximize size={20} />
            </button>
          )}
          <button type="button" className="botao-icone" onClick={aoAbrirConfiguracoes} aria-label="Configurações do aparelho">
            <Settings size={20} />
          </button>
        </div>
      </header>
      {info && !info.empresa.ativo && <div className="terminal-faixa">Empresa desativada no painel: os registros serão recusados.</div>}
    </>
  )
}

import { CloudUpload, Fingerprint, Maximize, Settings, WifiOff } from 'lucide-react'
import { dataPorExtenso, horaLocal } from '../../../lib/tempo'
import type { InfoAparelho } from './useSincronizacao'

/** Empresa e aparelho, relógio oficial, batidas guardadas sem internet e ações (tela cheia, configurações). */
export default function TopoTerminal({
  info,
  agora,
  fuso,
  conectado,
  guardadas,
  enviandoGuardadas,
  aoAbrirConfiguracoes,
}: {
  info: InfoAparelho | null
  agora: Date
  fuso: string
  conectado: boolean
  guardadas: number
  enviandoGuardadas: boolean
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
          {/* No celular, os selos mostram só o ícone (e o número de batidas guardadas). */}
          {!conectado && (
            <span className="terminal-offline" title="Sem internet">
              <WifiOff size={16} aria-hidden /> <span className="terminal-rotulo">Sem internet</span>
            </span>
          )}
          {guardadas > 0 && (
            <span className="terminal-guardadas" title="Batidas feitas sem internet, esperando a conexão para serem enviadas">
              <CloudUpload size={16} aria-hidden />{' '}
              {enviandoGuardadas ? (
                <span className="terminal-rotulo">Enviando batidas...</span>
              ) : (
                <>
                  {guardadas}
                  <span className="terminal-rotulo">{guardadas === 1 ? ' batida guardada' : ' batidas guardadas'}</span>
                </>
              )}
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

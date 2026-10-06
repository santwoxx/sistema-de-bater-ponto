import { collection } from 'firebase/firestore'
import { Ban, Copy, Tablet } from 'lucide-react'
import { useState } from 'react'
import { api } from '../../api'
import { Aviso, CabecalhoPagina, Carregando, Selo, Vazio } from '../../componentes/Basicos'
import Modal from '../../componentes/Modal'
import { useNotificar } from '../../componentes/Notificacoes'
import { useEmpresaAtual } from '../../contexto/Empresa'
import { db } from '../../firebase'
import { useAgora, useColecao } from '../../hooks/useColecao'
import { mensagemErro } from '../../lib/erros'
import { formatarDataHora, tempoRelativo } from '../../lib/tempo'
import { paraDispositivo, type Dispositivo } from '../../tipos'

const ONLINE_MS = 20 * 60_000

function resumirNavegador(agente?: string): string {
  if (!agente) return '—'
  const sistema = /iPad|iPhone|iPod/.test(agente)
    ? 'iPhone/iPad'
    : /Android/.test(agente)
      ? 'Android'
      : /Windows/.test(agente)
        ? 'Windows'
        : /Mac OS/.test(agente)
          ? 'Mac'
          : /Linux/.test(agente)
            ? 'Linux'
            : 'Outro'
  const navegador = /Edg\//.test(agente)
    ? 'Edge'
    : /SamsungBrowser/.test(agente)
      ? 'Samsung Internet'
      : /Chrome\//.test(agente)
        ? 'Chrome'
        : /Firefox\//.test(agente)
          ? 'Firefox'
          : /Safari\//.test(agente)
            ? 'Safari'
            : 'Navegador'
  return `${navegador} · ${sistema}`
}

export default function Aparelhos() {
  const empresa = useEmpresaAtual()
  const notificar = useNotificar()
  const agora = useAgora(30_000)
  const aparelhos = useColecao(() => collection(db, 'empresas', empresa.id, 'dispositivos'), paraDispositivo, `${empresa.id}:aparelhos`)
  const [desativando, setDesativando] = useState<Dispositivo | null>(null)
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState('')
  const endereco = `${window.location.origin}/ponto`

  const lista = [...aparelhos.dados].sort((a, b) => Number(b.ativo) - Number(a.ativo) || a.nome.localeCompare(b.nome, 'pt-BR'))

  async function copiar() {
    try {
      await navigator.clipboard.writeText(endereco)
      notificar('Endereço copiado.')
    } catch {
      notificar('Não foi possível copiar. Selecione o endereço e copie manualmente.', 'info')
    }
  }

  async function desativar() {
    if (!desativando) return
    setErro('')
    setSalvando(true)
    try {
      await api.desativarDispositivo({ empresaId: empresa.id, dispositivoId: desativando.id })
      notificar(`Aparelho "${desativando.nome}" desativado.`)
      setDesativando(null)
    } catch (e) {
      setErro(mensagemErro(e))
    } finally {
      setSalvando(false)
    }
  }

  return (
    <>
      <CabecalhoPagina titulo="Aparelhos de ponto" descricao="Tablets, celulares ou computadores onde a equipe bate o ponto." />

      <section className="cartao passos">
        <h2>Como ativar um aparelho</h2>
        <ol>
          <li>
            No aparelho da loja, abra o endereço:{' '}
            <span className="endereco">
              <code>{endereco}</code>
              <button type="button" className="botao-icone" onClick={copiar} aria-label="Copiar endereço">
                <Copy size={16} />
              </button>
            </span>
          </li>
          <li>Entre com o seu e-mail e senha de gestor, escolha a empresa "{empresa.nome}" e dê um nome ao aparelho.</li>
          <li>Permita o uso da câmera quando o navegador pedir. Pronto: o aparelho fica no modo ponto.</li>
        </ol>
        <p className="texto-suave">
          Dica: no Android, use "Fixar app" (ou um navegador de quiosque); no iPad, use o "Acesso Guiado". Assim ninguém sai da tela do
          ponto.
        </p>
      </section>

      {aparelhos.erro && <Aviso tipo="erro">{aparelhos.erro}</Aviso>}

      <section className="cartao sem-preenchimento">
        {aparelhos.carregando ? (
          <Carregando />
        ) : lista.length === 0 ? (
          <Vazio icone={Tablet} titulo="Nenhum aparelho ativado" />
        ) : (
          <div className="tabela-rolagem">
            <table className="tabela">
              <thead>
                <tr>
                  <th>Aparelho</th>
                  <th>Situação</th>
                  <th>Último registro de ponto</th>
                  <th>Navegador</th>
                  <th>Ativado</th>
                  <th aria-label="Ações" />
                </tr>
              </thead>
              <tbody>
                {lista.map((a) => {
                  const sinal = a.ultimoSinalEm?.toMillis()
                  return (
                    <tr key={a.id} className={a.ativo ? '' : 'desconsiderada'}>
                      <td>
                        <strong>{a.nome}</strong>
                      </td>
                      <td>
                        {!a.ativo ? (
                          <Selo>Desativado</Selo>
                        ) : sinal && agora - sinal < ONLINE_MS ? (
                          <Selo cor="verde">Online</Selo>
                        ) : (
                          <Selo cor="amarelo">{sinal ? `Sem sinal ${tempoRelativo(sinal, agora)}` : 'Nunca conectou'}</Selo>
                        )}
                      </td>
                      <td>{a.ultimoRegistroEm ? formatarDataHora(a.ultimoRegistroEm.toDate(), empresa.fusoHorario) : '—'}</td>
                      <td>{resumirNavegador(a.agenteUsuario)}</td>
                      <td>
                        {a.criadoEm ? formatarDataHora(a.criadoEm.toDate(), empresa.fusoHorario) : '—'}
                        {a.criadoPor && <small className="bloco">por {a.criadoPor.nome}</small>}
                      </td>
                      <td>
                        {a.ativo && (
                          <button type="button" className="botao pequeno perigo-suave" onClick={() => setDesativando(a)}>
                            <Ban size={14} aria-hidden /> Desativar
                          </button>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {desativando && (
        <Modal
          titulo="Desativar aparelho"
          largura="pequena"
          aoFechar={() => setDesativando(null)}
          rodape={
            <>
              <button type="button" className="botao fantasma" onClick={() => setDesativando(null)} disabled={salvando}>
                Cancelar
              </button>
              <button type="button" className="botao perigo" onClick={desativar} disabled={salvando}>
                {salvando ? 'Desativando...' : 'Desativar'}
              </button>
            </>
          }
        >
          <p>
            O aparelho <strong>"{desativando.nome}"</strong> deixará de registrar ponto imediatamente. As marcações já feitas continuam
            guardadas. Para usá-lo de novo, será preciso ativá-lo outra vez.
          </p>
          {erro && <Aviso tipo="erro">{erro}</Aviso>}
        </Modal>
      )}
    </>
  )
}

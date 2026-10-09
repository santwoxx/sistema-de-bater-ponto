import { collection } from 'firebase/firestore'
import { Ban, Copy, Smartphone, Tablet } from 'lucide-react'
import { useState } from 'react'
import { api } from '../../api'
import { Aviso, CabecalhoPagina, Carregando, Selo, Vazio } from '../../componentes/Basicos'
import Modal from '../../componentes/Modal'
import { useNotificar } from '../../componentes/Notificacoes'
import UsoDoAparelho from '../../componentes/UsoDoAparelho'
import { useEmpresaAtual } from '../../contexto/Empresa'
import { db } from '../../firebase'
import { useAgora, useColecao } from '../../hooks/useColecao'
import { mensagemDaCamera, navegadorInterno, plataformaDe } from '../../lib/camera'
import { mensagemErro } from '../../lib/erros'
import { formatarDataHora, tempoRelativo } from '../../lib/tempo'
import { paraDispositivo, paraFuncionario, type Dispositivo, type Funcionario } from '../../tipos'

const ONLINE_MS = 20 * 60_000

// O que o problema da câmera informado pelo aparelho quer dizer (ver lib/camera.ts).
const PROBLEMA_DA_CAMERA: Record<string, string> = {
  NotAllowedError: 'bloqueada no navegador',
  SecurityError: 'bloqueada no navegador',
  NotReadableError: 'ocupada por outro aplicativo ou travada',
  AbortError: 'ocupada por outro aplicativo ou travada',
  NotFoundError: 'nenhuma câmera encontrada',
  SemSuporte: 'o navegador não permite câmera',
  Inseguro: 'aberto sem https',
  SemImagem: 'abre, mas sem imagem',
  Desconectada: 'desligada pelo aparelho',
  Aguardando: 'esperando alguém tocar em "Ligar a câmera"',
  ReproducaoBloqueada: 'esperando um toque para mostrar a imagem',
}

const problemaDaCamera = (codigo: string | null) => PROBLEMA_DA_CAMERA[codigo ?? ''] ?? `erro${codigo ? ` (${codigo})` : ''}`

function SituacaoCamera({ aparelho }: { aparelho: Dispositivo }) {
  const camera = aparelho.camera
  if (!aparelho.ativo || !camera) return <>—</>
  if (camera.estado === 'pronta') return <Selo cor="verde">Funcionando{camera.resolucao ? ` · ${camera.resolucao.replace('x', '×')}` : ''}</Selo>
  if (camera.estado === 'iniciando') return <Selo>Ligando</Selo>
  return (
    <span title={camera.detalhe ?? undefined}>
      <Selo cor={camera.estado === 'erro' ? 'vermelho' : 'amarelo'}>{camera.estado === 'toque' ? 'Esperando toque' : 'Com problema'}</Selo>
      <small className="bloco">{problemaDaCamera(camera.codigo)}</small>
    </span>
  )
}

/** Aparelho da loja ou celular pessoal (com o aviso se o dono foi desativado). */
function UsoAtual({ aparelho, funcionarios }: { aparelho: Dispositivo; funcionarios: Funcionario[] }) {
  if (!aparelho.funcionarioId) return <Selo>Loja (todos)</Selo>
  const dono = funcionarios.find((f) => f.id === aparelho.funcionarioId)
  const nome = dono?.nome ?? aparelho.funcionarioNome ?? 'funcionário removido'
  const donoInativo = aparelho.ativo && dono !== undefined && !dono.ativo
  return (
    <>
      <Selo cor={donoInativo ? 'amarelo' : 'azul'}>Celular pessoal</Selo>
      <small className="bloco">{nome}</small>
      {donoInativo && <small className="bloco">funcionário desativado: ninguém bate ponto neste aparelho</small>}
    </>
  )
}

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
  const funcionarios = useColecao(() => collection(db, 'empresas', empresa.id, 'funcionarios'), paraFuncionario, `${empresa.id}:todos`)
  const [desativando, setDesativando] = useState<Dispositivo | null>(null)
  const [mudandoUso, setMudandoUso] = useState<Dispositivo | null>(null)
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState('')
  const endereco = `${window.location.origin}/ponto`

  const lista = [...aparelhos.dados].sort((a, b) => Number(b.ativo) - Number(a.ativo) || a.nome.localeCompare(b.nome, 'pt-BR'))
  // Aparelho ativo cuja câmera não está funcionando: sem câmera, ninguém bate o ponto nele.
  const comProblema = lista.filter((a) => a.ativo && (a.camera?.estado === 'erro' || a.camera?.estado === 'toque'))

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
            No aparelho da loja (ou no celular do funcionário), abra o endereço:{' '}
            <span className="endereco">
              <code>{endereco}</code>
              <button type="button" className="botao-icone" onClick={copiar} aria-label="Copiar endereço">
                <Copy size={16} />
              </button>
            </span>
          </li>
          <li>
            Entre com o seu e-mail e senha de gestor (ou a conta Google), escolha a empresa "{empresa.nome}", diga se é o aparelho da
            loja ou o celular pessoal de um funcionário e dê um nome ao aparelho.
          </li>
          <li>
            Se aparecer o botão "Ligar a câmera", toque nele, e permita o uso da câmera quando o navegador pedir. Pronto: o aparelho
            fica no modo ponto.
          </li>
        </ol>
        <p className="texto-suave">
          No celular pessoal, só o dono bate ponto, e a tela já pede só o PIN dele. Dá para mudar o uso depois, na coluna "Uso".
        </p>
        <p className="texto-suave">
          Dica: no Android, use "Fixar app" (ou um navegador de quiosque); no iPad, use o "Acesso Guiado". Assim ninguém sai da tela do
          ponto.
        </p>
      </section>

      {aparelhos.erro && <Aviso tipo="erro">{aparelhos.erro}</Aviso>}
      {comProblema.map((a) => {
        const agente = a.agenteUsuario ?? ''
        const quando = a.camera?.atualizadaEm ? `, informado ${tempoRelativo(a.camera.atualizadaEm.toMillis(), agora)}` : ''
        return (
          <Aviso key={a.id} tipo="alerta">
            <strong>
              Câmera do aparelho "{a.nome}": {problemaDaCamera(a.camera!.codigo)}.
            </strong>{' '}
            {mensagemDaCamera(a.camera!.codigo ?? '', plataformaDe(agente), navegadorInterno(agente))}{' '}
            <small>
              (código {a.camera!.codigo ?? '—'}
              {a.camera!.detalhe ? `: ${a.camera!.detalhe}` : ''}
              {quando})
            </small>
          </Aviso>
        )
      })}

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
                  <th>Uso</th>
                  <th>Câmera</th>
                  <th>Último registro de ponto</th>
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
                        <small className="bloco">{resumirNavegador(a.agenteUsuario)}</small>
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
                      <td>
                        <UsoAtual aparelho={a} funcionarios={funcionarios.dados} />
                        {a.ativo && (
                          <button type="button" className="link bloco" onClick={() => setMudandoUso(a)}>
                            Mudar
                          </button>
                        )}
                      </td>
                      <td>
                        <SituacaoCamera aparelho={a} />
                      </td>
                      <td>{a.ultimoRegistroEm ? formatarDataHora(a.ultimoRegistroEm.toDate(), empresa.fusoHorario) : '—'}</td>
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

      {mudandoUso && (
        <MudarUso aparelho={mudandoUso} funcionarios={funcionarios.dados} empresaId={empresa.id} aoFechar={() => setMudandoUso(null)} />
      )}

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

// Muda o uso de um aparelho já ativado; o servidor passa a valer na hora, e a
// tela do aparelho muda na próxima sincronização (em até 5 minutos).
function MudarUso({
  aparelho,
  funcionarios,
  empresaId,
  aoFechar,
}: {
  aparelho: Dispositivo
  funcionarios: Funcionario[]
  empresaId: string
  aoFechar: () => void
}) {
  const notificar = useNotificar()
  const donoAtivo = funcionarios.some((f) => f.id === aparelho.funcionarioId && f.ativo)
  const [donoId, setDonoId] = useState(donoAtivo ? (aparelho.funcionarioId ?? '') : '')
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState('')

  async function salvar() {
    setErro('')
    setSalvando(true)
    try {
      await api.salvarDispositivo({ empresaId, dispositivoId: aparelho.id, funcionarioId: donoId || null })
      const dono = funcionarios.find((f) => f.id === donoId)
      notificar(dono ? `"${aparelho.nome}" agora é o celular pessoal de ${dono.nome}.` : `"${aparelho.nome}" agora é aparelho da loja.`)
      aoFechar()
    } catch (e) {
      setErro(mensagemErro(e))
    } finally {
      setSalvando(false)
    }
  }

  return (
    <Modal
      titulo={`Uso do aparelho "${aparelho.nome}"`}
      largura="pequena"
      aoFechar={aoFechar}
      rodape={
        <>
          <button type="button" className="botao fantasma" onClick={aoFechar} disabled={salvando}>
            Cancelar
          </button>
          <button type="button" className="botao primario" onClick={salvar} disabled={salvando}>
            <Smartphone size={16} aria-hidden /> {salvando ? 'Salvando...' : 'Salvar'}
          </button>
        </>
      }
    >
      <UsoDoAparelho funcionarios={funcionarios} valor={donoId} aoMudar={setDonoId} />
      <p className="texto-suave">
        A tela do aparelho muda em até 5 minutos, sem precisar ativá-lo de novo. Para ser na hora, recarregue a tela do aparelho.
      </p>
      {erro && <Aviso tipo="erro">{erro}</Aviso>}
    </Modal>
  )
}

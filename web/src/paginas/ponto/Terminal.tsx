import { signInWithEmailAndPassword, signOut } from 'firebase/auth'
import {
  Camera,
  Check,
  CircleAlert,
  CircleCheck,
  ClockAlert,
  Delete,
  Fingerprint,
  LoaderCircle,
  Maximize,
  Send,
  Settings,
  WifiOff,
} from 'lucide-react'
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import { api, type ComprovantePonto, type Sincronizacao } from '../../api'
import { Aviso, Campo } from '../../componentes/Basicos'
import Modal from '../../componentes/Modal'
import { CHAVE_APARELHO } from '../../contexto/Sessao'
import { auth, criarSessaoTemporaria } from '../../firebase'
import { useCamera, useTelaSempreAcesa } from '../../hooks/useCamera'
import { useAgora } from '../../hooks/useColecao'
import { erroDeRede, mensagemErro } from '../../lib/erros'
import { formatarNsr } from '../../lib/formatos'
import { somErro, somFoto, somSucesso } from '../../lib/sons'
import { dataLocal, dataPorExtenso, formatarData, horaLocal, somarDias } from '../../lib/tempo'
import { gerarId, gravarLocal, lerLocal } from '../../lib/util'

type Etapa = 'matricula' | 'pin' | 'foto' | 'formulario' | 'enviando' | 'sucesso' | 'solicitado' | 'erro'
type InfoAparelho = Extract<Sincronizacao, { ativo: true }>

const CHAVE_INFO = 'ponto.info'
const SINCRONIZAR_A_CADA_MS = 5 * 60_000
const INATIVIDADE_MS = 20_000
const FORMULARIO_MS = 90_000
const RESULTADO_MS = 6_000
const TECLAS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'apagar', '0', 'ok']
const OUTRO_MOTIVO = 'Outro motivo'
const MOTIVOS = ['Esqueci de registrar', 'O aparelho estava sem internet ou com problema', 'Estava em trabalho externo', OUTRO_MOTIVO]

// Hora oficial: o relógio do aparelho pode estar errado, então a tela usa a
// hora do servidor (corrigida pela latência). O registro em si é sempre
// carimbado pelo servidor.
function useSincronizacao() {
  const [info, setInfo] = useState<InfoAparelho | null>(() => JSON.parse(lerLocal(CHAVE_INFO) ?? 'null'))
  const [deslocamento, setDeslocamento] = useState(0)
  const [conectado, setConectado] = useState(() => navigator.onLine)
  const [desativado, setDesativado] = useState(false)

  const sincronizar = useCallback(async () => {
    const inicio = Date.now()
    try {
      const resposta = await api.sincronizarDispositivo({})
      const fim = Date.now()
      setConectado(true)
      setDeslocamento(resposta.agora - (inicio + fim) / 2)
      if (!resposta.ativo) {
        setDesativado(true)
        return
      }
      setInfo(resposta)
      gravarLocal(CHAVE_INFO, JSON.stringify(resposta))
    } catch {
      setConectado(false)
    }
  }, [])

  useEffect(() => {
    void sincronizar()
    const id = setInterval(sincronizar, SINCRONIZAR_A_CADA_MS)
    const online = () => void sincronizar()
    const offline = () => setConectado(false)
    window.addEventListener('online', online)
    window.addEventListener('offline', offline)
    return () => {
      clearInterval(id)
      window.removeEventListener('online', online)
      window.removeEventListener('offline', offline)
    }
  }, [sincronizar])

  return { info, deslocamento, conectado, desativado, setConectado }
}

function esperar(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export default function Terminal({ empresaId }: { empresaId: string }) {
  const { videoRef, estado: estadoCamera, erro: erroCamera, iniciar: iniciarCamera, capturar } = useCamera()
  const { info, deslocamento, conectado, desativado, setConectado } = useSincronizacao()
  useTelaSempreAcesa()
  const agora = new Date(useAgora(1000) + deslocamento)
  const fuso = info?.empresa.fusoHorario ?? 'America/Sao_Paulo'

  const [etapa, setEtapa] = useState<Etapa>('matricula')
  const [matricula, setMatricula] = useState('')
  const [pin, setPin] = useState('')
  const [contagem, setContagem] = useState(3)
  const [comprovante, setComprovante] = useState<{ dados: ComprovantePonto; foto: string } | null>(null)
  const [mensagem, setMensagem] = useState('')
  const [configuracoes, setConfiguracoes] = useState(false)
  // "solicitacao": o funcionário esqueceu de bater e pede a inclusão do horário.
  const [modo, setModo] = useState<'ponto' | 'solicitacao'>('ponto')
  const [pedido, setPedido] = useState({ data: '', hora: '', motivo: MOTIVOS[0], outroMotivo: '' })
  const [pedidoEnviado, setPedidoEnviado] = useState<{ funcionarioNome: string; data: string; hora: string } | null>(null)
  const [erroPedido, setErroPedido] = useState('')

  const reiniciar = useCallback(() => {
    setEtapa('matricula')
    setModo('ponto')
    setMatricula('')
    setPin('')
    setMensagem('')
    setComprovante(null)
    setPedidoEnviado(null)
  }, [])

  const falhar = useCallback((texto: string) => {
    setMensagem(texto)
    setEtapa('erro')
    setPin('')
    somErro()
  }, [])

  const enviar = useCallback(async () => {
    const captura = capturar()
    if (!captura) {
      falhar('Não foi possível tirar a foto. Verifique a câmera e tente de novo.')
      return
    }
    somFoto()
    setEtapa('enviando')
    const dados = { idRequisicao: gerarId(), matricula, pin, foto: captura.foto, miniatura: captura.miniatura }
    try {
      let resultado: ComprovantePonto
      try {
        resultado = await api.registrarPonto(dados)
      } catch (e) {
        // Uma nova tentativa com o mesmo id nunca duplica o registro.
        if (!erroDeRede(e)) throw e
        await esperar(1500)
        resultado = await api.registrarPonto(dados)
      }
      setConectado(true)
      setComprovante({ dados: resultado, foto: captura.foto })
      setEtapa('sucesso')
      setPin('')
      somSucesso()
    } catch (e) {
      if (erroDeRede(e)) setConectado(false)
      falhar(mensagemErro(e))
    }
  }, [capturar, matricula, pin, falhar, setConectado])

  async function enviarPedido(e: FormEvent) {
    e.preventDefault()
    const motivo = pedido.motivo === OUTRO_MOTIVO ? pedido.outroMotivo.trim() : pedido.motivo
    if (!pedido.data || !/^\d{2}:\d{2}$/.test(pedido.hora)) return setErroPedido('Informe o dia e o horário que ficaram sem marcação.')
    if (motivo.length < 3) return setErroPedido('Escreva o motivo da solicitação.')
    // Foto pequena de quem pediu, como prova (se a câmera estiver disponível).
    const miniatura = estadoCamera === 'pronta' ? (capturar()?.miniatura ?? null) : null
    setEtapa('enviando')
    try {
      const resultado = await api.solicitarMarcacao({ matricula, pin, data: pedido.data, hora: pedido.hora, motivo, miniatura })
      setConectado(true)
      setPedidoEnviado(resultado)
      setEtapa('solicitado')
      setPin('')
      somSucesso()
    } catch (erro) {
      if (erroDeRede(erro)) setConectado(false)
      falhar(mensagemErro(erro))
    }
  }

  // Contagem regressiva antes da foto (começa em 3 ao entrar na etapa "foto").
  const enviarRef = useRef(enviar)
  useEffect(() => {
    enviarRef.current = enviar
  })
  useEffect(() => {
    if (etapa !== 'foto') return
    let restante = 3
    const id = setInterval(() => {
      restante -= 1
      if (restante > 0) {
        setContagem(restante)
      } else {
        clearInterval(id)
        void enviarRef.current()
      }
    }, 700)
    return () => clearInterval(id)
  }, [etapa])

  // Volta ao início após inatividade ou depois de mostrar o resultado.
  useEffect(() => {
    const emDigitacao = (etapa === 'matricula' || etapa === 'pin') && (matricula !== '' || pin !== '' || modo === 'solicitacao')
    const mostrandoResultado = etapa === 'sucesso' || etapa === 'erro' || etapa === 'solicitado'
    const espera = mostrandoResultado ? RESULTADO_MS : etapa === 'formulario' ? FORMULARIO_MS : emDigitacao ? INATIVIDADE_MS : 0
    if (!espera) return
    const id = setTimeout(reiniciar, espera)
    return () => clearTimeout(id)
  }, [etapa, matricula, pin, modo, pedido, reiniciar])

  const teclar = useCallback(
    (tecla: string) => {
      if (configuracoes) return
      if (etapa === 'sucesso' || etapa === 'erro' || etapa === 'solicitado') {
        reiniciar()
        return
      }
      if (etapa === 'matricula') {
        if (tecla === 'apagar') setMatricula((m) => m.slice(0, -1))
        else if (tecla === 'ok') {
          if (matricula) setEtapa('pin')
        } else if (matricula.length < 10) setMatricula((m) => m + tecla)
      } else if (etapa === 'pin') {
        if (tecla === 'apagar') {
          if (pin) setPin((p) => p.slice(0, -1))
          else setEtapa('matricula')
        } else if (tecla === 'ok') {
          if (pin.length < 4) return
          if (modo === 'solicitacao') {
            // O PIN é conferido no servidor junto com o pedido.
            setPedido({ data: dataLocal(new Date(Date.now() + deslocamento), fuso), hora: '', motivo: MOTIVOS[0], outroMotivo: '' })
            setErroPedido('')
            setEtapa('formulario')
          } else if (estadoCamera !== 'pronta') {
            falhar(erroCamera || 'A câmera ainda não está pronta. Aguarde e tente de novo.')
          } else {
            setContagem(3)
            setEtapa('foto')
          }
        } else if (pin.length < 6) setPin((p) => p + tecla)
      }
    },
    [configuracoes, etapa, matricula, pin, modo, deslocamento, fuso, estadoCamera, erroCamera, reiniciar, falhar],
  )

  // Também aceita teclado físico (computador com webcam).
  useEffect(() => {
    const aoTeclar = (e: KeyboardEvent) => {
      if (configuracoes || etapa === 'formulario') return
      if (e.target instanceof HTMLElement && e.target.closest('input, select, textarea')) return
      if (/^\d$/.test(e.key)) teclar(e.key)
      else if (e.key === 'Backspace') teclar('apagar')
      else if (e.key === 'Enter') teclar('ok')
      else if (e.key === 'Escape') reiniciar()
      else return
      e.preventDefault()
    }
    window.addEventListener('keydown', aoTeclar)
    return () => window.removeEventListener('keydown', aoTeclar)
  }, [teclar, reiniciar, configuracoes, etapa])

  if (desativado) {
    return (
      <div className="tela-acesso escuro">
        <div className="cartao-acesso">
          <h1>Aparelho desativado</h1>
          <Aviso tipo="alerta">Este aparelho foi desativado pelo gestor e não registra mais ponto.</Aviso>
          <button
            type="button"
            className="botao primario grande"
            onClick={() => {
              gravarLocal(CHAVE_APARELHO, null)
              gravarLocal(CHAVE_INFO, null)
              void signOut(auth)
            }}
          >
            Ativar novamente
          </button>
        </div>
      </div>
    )
  }

  const podeConfirmar = etapa === 'matricula' ? matricula.length > 0 : etapa === 'pin' ? pin.length >= 4 : false
  const bloqueado = etapa === 'foto' || etapa === 'enviando'
  const hojeLocal = dataLocal(agora, fuso)
  const titulo =
    etapa === 'pin'
      ? 'Digite seu PIN'
      : modo === 'solicitacao'
        ? 'Esqueceu de bater? Digite sua matrícula'
        : etapa === 'foto'
          ? 'Olhe para a câmera'
          : etapa === 'enviando'
            ? 'Registrando...'
            : 'Digite sua matrícula'

  return (
    <div className="terminal">
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
          <button type="button" className="botao-icone" onClick={() => setConfiguracoes(true)} aria-label="Configurações do aparelho">
            <Settings size={20} />
          </button>
        </div>
      </header>

      {info && !info.empresa.ativo && <div className="terminal-faixa">Empresa desativada no painel: os registros serão recusados.</div>}

      <div className="terminal-corpo">
        <section className="terminal-camera">
          <video ref={videoRef} autoPlay playsInline muted />
          <div className="moldura-rosto" aria-hidden />
          {estadoCamera !== 'pronta' && (
            <div className="camera-aviso">
              {estadoCamera === 'iniciando' ? (
                <>
                  <LoaderCircle className="girando" aria-hidden /> Ligando a câmera...
                </>
              ) : (
                <>
                  <Camera aria-hidden />
                  <p>{erroCamera}</p>
                  <button type="button" className="botao" onClick={() => void iniciarCamera()}>
                    Tentar novamente
                  </button>
                </>
              )}
            </div>
          )}
          {etapa === 'foto' && (
            <div className="contagem" aria-live="assertive">
              <span key={contagem}>{contagem}</span>
              <p>Olhe para a câmera</p>
            </div>
          )}
          {etapa === 'enviando' && (
            <div className="camera-aviso">
              <LoaderCircle className="girando" aria-hidden /> {modo === 'solicitacao' ? 'Enviando a solicitação...' : 'Registrando...'}
            </div>
          )}
        </section>

        <section className="terminal-painel">
          {etapa === 'formulario' || (etapa === 'enviando' && modo === 'solicitacao') ? (
            <form className="terminal-formulario" onSubmit={enviarPedido}>
              <h1>Qual marcação ficou faltando?</h1>
              <p className="terminal-instrucao">
                Matrícula {matricula}. A marcação só passa a valer depois que o gestor aprovar.
              </p>
              <div className="terminal-campos">
                <label>
                  Dia
                  <input
                    type="date"
                    value={pedido.data}
                    min={somarDias(hojeLocal, -31)}
                    max={hojeLocal}
                    onChange={(e) => setPedido({ ...pedido, data: e.target.value })}
                  />
                </label>
                <label>
                  Horário
                  <input type="time" value={pedido.hora} onChange={(e) => setPedido({ ...pedido, hora: e.target.value })} />
                </label>
              </div>
              <label>
                Motivo
                <select value={pedido.motivo} onChange={(e) => setPedido({ ...pedido, motivo: e.target.value })}>
                  {MOTIVOS.map((m) => (
                    <option key={m}>{m}</option>
                  ))}
                </select>
              </label>
              {pedido.motivo === OUTRO_MOTIVO && (
                <label>
                  Explique
                  <input
                    value={pedido.outroMotivo}
                    maxLength={300}
                    onChange={(e) => setPedido({ ...pedido, outroMotivo: e.target.value })}
                    autoFocus
                  />
                </label>
              )}
              {erroPedido && <p className="terminal-erro">{erroPedido}</p>}
              <div className="terminal-botoes">
                <button type="button" className="tecla tecla-apagar" onClick={reiniciar} disabled={etapa === 'enviando'}>
                  Cancelar
                </button>
                <button type="submit" className="tecla tecla-ok" disabled={etapa === 'enviando'}>
                  <Send size={22} aria-hidden /> Enviar pedido
                </button>
              </div>
            </form>
          ) : (
            <>
            <h1>{titulo}</h1>
            <div className="visor" aria-live="polite">
              {etapa === 'pin' || (bloqueado && pin) ? (
                <>
                  <small>Matrícula {matricula}</small>
                  <div className="pontos-pin">
                    {Array.from({ length: Math.max(4, pin.length) }, (_, i) => (
                      <span key={i} className={i < pin.length ? 'cheio' : ''} />
                    ))}
                  </div>
                </>
              ) : (
                <span className="visor-numero">{matricula || <span className="visor-dica">0000</span>}</span>
              )}
            </div>
            <div className="teclado">
              {TECLAS.map((t) => (
                <button
                  key={t}
                  type="button"
                  className={`tecla ${t === 'ok' ? 'tecla-ok' : ''} ${t === 'apagar' ? 'tecla-apagar' : ''}`}
                  disabled={bloqueado || (t === 'ok' && !podeConfirmar)}
                  onClick={() => teclar(t)}
                  aria-label={t === 'ok' ? 'Confirmar' : t === 'apagar' ? 'Apagar' : t}
                >
                  {t === 'ok' ? <Check size={30} /> : t === 'apagar' ? <Delete size={28} /> : t}
                </button>
              ))}
            </div>
            {modo === 'solicitacao' ? (
              <button type="button" className="terminal-link" onClick={reiniciar}>
                Cancelar e voltar ao ponto
              </button>
            ) : (
              etapa === 'matricula' && (
                <button
                  type="button"
                  className="terminal-esqueci"
                  onClick={() => {
                    setMatricula('')
                    setModo('solicitacao')
                  }}
                >
                  <ClockAlert size={20} aria-hidden /> Esqueci de bater o ponto
                </button>
              )
            )}
            <p className="terminal-instrucao">
              {etapa === 'pin'
                ? modo === 'solicitacao'
                  ? 'Depois do PIN, informe o dia e o horário que ficou sem marcação.'
                  : 'Ao confirmar, olhe para a câmera: a foto é tirada automaticamente.'
                : bloqueado
                  ? 'Fique parado, olhando para a câmera.'
                  : 'Matrícula, depois o PIN.'}
            </p>
            </>
          )}
        </section>
      </div>

      {etapa === 'sucesso' && comprovante && (
        <div className="resultado resultado-sucesso" onClick={reiniciar} role="status">
          <CircleCheck size={72} aria-hidden />
          <h2>Ponto registrado!</h2>
          <img src={comprovante.foto} alt="" className="resultado-foto" />
          <strong className="resultado-nome">{comprovante.dados.funcionarioNome}</strong>
          <span className={`resultado-tipo resultado-${comprovante.dados.tipo}`}>
            {comprovante.dados.tipo === 'entrada' ? 'Entrada' : 'Saída'} · {comprovante.dados.ordinal}ª marcação do dia
          </span>
          <span className="resultado-hora">{comprovante.dados.horaLocal}</span>
          <span>{dataPorExtenso(new Date(comprovante.dados.dataHora), fuso)}</span>
          <small>
            NSR {formatarNsr(comprovante.dados.nsr)} · Código {comprovante.dados.codigoVerificacao}
          </small>
        </div>
      )}

      {etapa === 'solicitado' && pedidoEnviado && (
        <div className="resultado resultado-solicitado" onClick={reiniciar} role="status">
          <Send size={64} aria-hidden />
          <h2>Solicitação enviada!</h2>
          <strong className="resultado-nome">{pedidoEnviado.funcionarioNome}</strong>
          <p>
            Marcação de {formatarData(pedidoEnviado.data)} às {pedidoEnviado.hora}
          </p>
          <small>Ela passa a valer depois que o gestor aprovar.</small>
        </div>
      )}

      {etapa === 'erro' && (
        <div className="resultado resultado-erro" onClick={reiniciar} role="alert">
          <CircleAlert size={72} aria-hidden />
          <h2>{modo === 'solicitacao' ? 'Não foi possível enviar' : 'Não foi possível registrar'}</h2>
          <p>{mensagem}</p>
          <small>Toque para tentar de novo</small>
        </div>
      )}

      {configuracoes && (
        <ConfiguracoesAparelho empresaId={empresaId} info={info} aoFechar={() => setConfiguracoes(false)} />
      )}
    </div>
  )
}

function ConfiguracoesAparelho({ empresaId, info, aoFechar }: { empresaId: string; info: InfoAparelho | null; aoFechar: () => void }) {
  const [email, setEmail] = useState('')
  const [senha, setSenha] = useState('')
  const [erro, setErro] = useState('')
  const [ocupado, setOcupado] = useState(false)

  async function desativar(e: FormEvent) {
    e.preventDefault()
    const dispositivoId = auth.currentUser?.uid
    if (!dispositivoId) return
    setErro('')
    setOcupado(true)
    const temporaria = criarSessaoTemporaria()
    try {
      await signInWithEmailAndPassword(temporaria.auth, email.trim(), senha)
      await api.desativarDispositivo({ empresaId, dispositivoId }, temporaria.functions)
      gravarLocal(CHAVE_APARELHO, null)
      gravarLocal(CHAVE_INFO, null)
      await signOut(auth)
    } catch (err) {
      setErro(mensagemErro(err))
    } finally {
      await temporaria.encerrar()
      setOcupado(false)
    }
  }

  return (
    <Modal titulo="Configurações do aparelho" aoFechar={aoFechar} largura="pequena">
      <dl className="lista-dados">
        <dt>Empresa</dt>
        <dd>{info?.empresa.nome ?? '—'}</dd>
        <dt>Aparelho</dt>
        <dd>{info?.dispositivo.nome ?? '—'}</dd>
      </dl>
      <div className="acoes-detalhe">
        <button type="button" className="botao" onClick={() => window.location.reload()}>
          Recarregar a tela
        </button>
      </div>
      <form onSubmit={desativar} className="formulario">
        <h3>Desativar este aparelho</h3>
        <p className="texto-suave">Exige e-mail e senha de um gestor da empresa.</p>
        <Campo rotulo="E-mail do gestor">
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="off" required />
        </Campo>
        <Campo rotulo="Senha">
          <input type="password" value={senha} onChange={(e) => setSenha(e.target.value)} autoComplete="off" required />
        </Campo>
        {erro && <Aviso tipo="erro">{erro}</Aviso>}
        <button type="submit" className="botao perigo" disabled={ocupado}>
          {ocupado ? 'Desativando...' : 'Desativar aparelho'}
        </button>
      </form>
    </Modal>
  )
}

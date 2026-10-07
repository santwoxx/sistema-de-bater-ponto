import { signInWithEmailAndPassword, signOut } from 'firebase/auth'
import {
  Camera,
  Check,
  CircleAlert,
  CircleCheck,
  ClockAlert,
  Delete,
  FileSignature,
  Fingerprint,
  Info,
  KeyRound,
  LoaderCircle,
  Maximize,
  Send,
  Settings,
  WifiOff,
} from 'lucide-react'
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import { api, type ComprovantePonto, type EspelhoParaAssinar, type Sincronizacao } from '../../api'
import { Aviso, Campo } from '../../componentes/Basicos'
import Modal from '../../componentes/Modal'
import { CHAVE_APARELHO } from '../../contexto/Sessao'
import { auth, criarSessaoTemporaria } from '../../firebase'
import { useCamera, useTelaSempreAcesa } from '../../hooks/useCamera'
import { useAgora } from '../../hooks/useColecao'
import { erroDeRede, mensagemErro, pinProvisorio } from '../../lib/erros'
import { formatarNsr } from '../../lib/formatos'
import { problemaNoPin } from '../../lib/pin'
import { somErro, somFoto, somSucesso } from '../../lib/sons'
import { dataLocal, dataPorExtenso, formatarData, horaLocal, nomeMes, somarDias } from '../../lib/tempo'
import { gerarId, gravarLocal, lerLocal } from '../../lib/util'
import ConferenciaEspelho from './ConferenciaEspelho'

type Etapa =
  | 'matricula'
  | 'pin'
  // O funcionário cria o PIN pessoal (ou troca o PIN): digita o novo e confirma.
  | 'novoPin'
  | 'confirmarPin'
  | 'foto'
  | 'formulario'
  | 'enviando'
  | 'espelho'
  | 'sucesso'
  | 'solicitado'
  | 'assinado'
  | 'informacao'
  | 'pinDefinido'
  | 'erro'
type InfoAparelho = Extract<Sincronizacao, { ativo: true }>

const CHAVE_INFO = 'ponto.info'
const SINCRONIZAR_A_CADA_MS = 5 * 60_000
const INATIVIDADE_MS = 20_000
const FORMULARIO_MS = 90_000
const CONFERENCIA_MS = 3 * 60_000
const RESULTADO_MS = 6_000
const ETAPAS_DE_RESULTADO: Etapa[] = ['sucesso', 'erro', 'solicitado', 'assinado', 'informacao', 'pinDefinido']
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
  // "assinatura": o funcionário confere e assina o espelho de um mês fechado.
  // "trocarPin": o funcionário troca o próprio PIN.
  const [modo, setModo] = useState<'ponto' | 'solicitacao' | 'assinatura' | 'trocarPin'>('ponto')
  const [pedido, setPedido] = useState({ data: '', hora: '', motivo: MOTIVOS[0], outroMotivo: '' })
  const [pedidoEnviado, setPedidoEnviado] = useState<{ funcionarioNome: string; data: string; hora: string } | null>(null)
  const [erroPedido, setErroPedido] = useState('')
  const [espelhos, setEspelhos] = useState<EspelhoParaAssinar[]>([])
  const [indiceEspelho, setIndiceEspelho] = useState(0)
  const [assinando, setAssinando] = useState(false)
  const [erroAssinatura, setErroAssinatura] = useState('')
  const [assinatura, setAssinatura] = useState<{ status: 'assinado' | 'contestado'; mes: string; codigo: string } | null>(null)
  // PIN pessoal: o primeiro uso (PIN provisório do gestor) e a troca voluntária passam por aqui.
  const [novoPin, setNovoPin] = useState('')
  const [primeiroNovoPin, setPrimeiroNovoPin] = useState('')
  const [erroPin, setErroPin] = useState('')
  const [pinPessoalCriado, setPinPessoalCriado] = useState(false)
  const [salvandoPin, setSalvandoPin] = useState(false)

  const reiniciar = useCallback(() => {
    setEtapa('matricula')
    setModo('ponto')
    setMatricula('')
    setPin('')
    setMensagem('')
    setComprovante(null)
    setPedidoEnviado(null)
    setEspelhos([])
    setIndiceEspelho(0)
    setErroAssinatura('')
    setAssinatura(null)
    setNovoPin('')
    setPrimeiroNovoPin('')
    setErroPin('')
    setPinPessoalCriado(false)
    setSalvandoPin(false)
  }, [])

  const falhar = useCallback((texto: string) => {
    setMensagem(texto)
    setEtapa('erro')
    setPin('')
    somErro()
  }, [])

  // O servidor recusou o PIN provisório do gestor: o funcionário cria o dele e a ação continua.
  const pedirPinPessoal = useCallback(() => {
    setNovoPin('')
    setPrimeiroNovoPin('')
    setErroPin('')
    setEtapa('novoPin')
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
      if (pinProvisorio(e)) return pedirPinPessoal()
      if (erroDeRede(e)) setConectado(false)
      falhar(mensagemErro(e))
    }
  }, [capturar, matricula, pin, falhar, setConectado, pedirPinPessoal])

  const motivoDoPedido = pedido.motivo === OUTRO_MOTIVO ? pedido.outroMotivo.trim() : pedido.motivo

  async function enviarPedido(e: FormEvent) {
    e.preventDefault()
    if (!pedido.data || !/^\d{2}:\d{2}$/.test(pedido.hora)) return setErroPedido('Informe o dia e o horário que ficaram sem marcação.')
    if (motivoDoPedido.length < 3) return setErroPedido('Escreva o motivo da solicitação.')
    await enviarSolicitacao(pin)
  }

  async function enviarSolicitacao(pinUsado: string) {
    // Foto pequena de quem pediu, como prova (se a câmera estiver disponível).
    const miniatura = estadoCamera === 'pronta' ? (capturar()?.miniatura ?? null) : null
    setEtapa('enviando')
    try {
      const resultado = await api.solicitarMarcacao({
        matricula,
        pin: pinUsado,
        data: pedido.data,
        hora: pedido.hora,
        motivo: motivoDoPedido,
        miniatura,
      })
      setConectado(true)
      setPedidoEnviado(resultado)
      setEtapa('solicitado')
      setPin('')
      somSucesso()
    } catch (erro) {
      if (pinProvisorio(erro)) return pedirPinPessoal()
      if (erroDeRede(erro)) setConectado(false)
      falhar(mensagemErro(erro))
    }
  }

  const buscarEspelhos = useCallback(async (pinUsado: string) => {
    setEtapa('enviando')
    try {
      const resposta = await api.consultarEspelhosPendentes({ matricula, pin: pinUsado })
      setConectado(true)
      if (resposta.espelhos.length === 0) {
        setPin('')
        setMensagem(`${resposta.funcionarioNome}, não há espelho de ponto aguardando a sua assinatura.`)
        setEtapa('informacao')
        return
      }
      setEspelhos(resposta.espelhos)
      setIndiceEspelho(0)
      setErroAssinatura('')
      setEtapa('espelho')
    } catch (e) {
      if (pinProvisorio(e)) return pedirPinPessoal()
      if (erroDeRede(e)) setConectado(false)
      falhar(mensagemErro(e))
    }
  }, [matricula, falhar, setConectado, pedirPinPessoal])

  async function assinar(concordo: boolean, motivo?: string) {
    const espelho = espelhos[indiceEspelho]
    if (!espelho) return
    setErroAssinatura('')
    setAssinando(true)
    // Foto pequena de quem assinou, como prova (se a câmera estiver disponível).
    const miniatura = estadoCamera === 'pronta' ? (capturar()?.miniatura ?? null) : null
    try {
      const resultado = await api.assinarEspelho({ matricula, pin, espelhoId: espelho.id, hash: espelho.hash, concordo, motivo, miniatura })
      setConectado(true)
      setAssinatura(resultado)
      setEtapa('assinado')
      somSucesso()
    } catch (e) {
      if (erroDeRede(e)) setConectado(false)
      setErroAssinatura(mensagemErro(e))
      somErro()
    } finally {
      setAssinando(false)
    }
  }

  async function salvarPinPessoal(pinNovo: string) {
    // Foto pequena de quem criou ou trocou o PIN, como prova (se a câmera estiver disponível).
    const miniatura = estadoCamera === 'pronta' ? (capturar()?.miniatura ?? null) : null
    setSalvandoPin(true)
    setEtapa('enviando')
    try {
      await api.definirPin({ matricula, pin, novoPin: pinNovo, miniatura })
      setConectado(true)
      setNovoPin('')
      setPrimeiroNovoPin('')
      setSalvandoPin(false)
      if (modo === 'trocarPin') {
        setPin('')
        setEtapa('pinDefinido')
        somSucesso()
        return
      }
      // Primeiro uso: segue com o que a pessoa ia fazer, já com o PIN novo.
      setPin(pinNovo)
      setPinPessoalCriado(true)
      if (modo === 'solicitacao') await enviarSolicitacao(pinNovo)
      else if (modo === 'assinatura') await buscarEspelhos(pinNovo)
      else if (estadoCamera !== 'pronta') falhar(erroCamera || 'Seu PIN foi criado, mas a câmera não está pronta. Tente bater o ponto de novo.')
      else {
        setContagem(3)
        setEtapa('foto')
      }
    } catch (e) {
      setSalvandoPin(false)
      if (erroDeRede(e)) setConectado(false)
      falhar(mensagemErro(e))
    }
  }
  const salvarPinRef = useRef(salvarPinPessoal)
  useEffect(() => {
    salvarPinRef.current = salvarPinPessoal
  })

  // Depois de assinar: segue para o próximo espelho pendente ou volta ao início.
  const continuarAposAssinatura = useCallback(() => {
    if (indiceEspelho + 1 < espelhos.length) {
      setIndiceEspelho(indiceEspelho + 1)
      setAssinatura(null)
      setEtapa('espelho')
    } else {
      reiniciar()
    }
  }, [indiceEspelho, espelhos.length, reiniciar])

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
    const emDigitacao = (etapa === 'matricula' || etapa === 'pin') && (matricula !== '' || pin !== '' || modo !== 'ponto')
    const criandoPin = etapa === 'novoPin' || etapa === 'confirmarPin'
    const espera = ETAPAS_DE_RESULTADO.includes(etapa)
      ? RESULTADO_MS
      : etapa === 'formulario'
        ? FORMULARIO_MS
        : etapa === 'espelho'
          ? CONFERENCIA_MS
          : criandoPin
            ? INATIVIDADE_MS * 2
            : emDigitacao
              ? INATIVIDADE_MS
              : 0
    if (!espera) return
    const id = setTimeout(etapa === 'assinado' ? continuarAposAssinatura : reiniciar, espera)
    return () => clearTimeout(id)
  }, [etapa, matricula, pin, novoPin, modo, pedido, indiceEspelho, reiniciar, continuarAposAssinatura])

  const teclar = useCallback(
    (tecla: string) => {
      if (configuracoes) return
      if (ETAPAS_DE_RESULTADO.includes(etapa)) {
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
          } else if (modo === 'assinatura') {
            void buscarEspelhos(pin)
          } else if (modo === 'trocarPin') {
            // O PIN atual é conferido no servidor junto com o novo.
            pedirPinPessoal()
          } else if (estadoCamera !== 'pronta') {
            falhar(erroCamera || 'A câmera ainda não está pronta. Aguarde e tente de novo.')
          } else {
            setContagem(3)
            setEtapa('foto')
          }
        } else if (pin.length < 6) setPin((p) => p + tecla)
      } else if (etapa === 'novoPin' || etapa === 'confirmarPin') {
        if (tecla === 'apagar') {
          if (novoPin) setNovoPin((p) => p.slice(0, -1))
          else if (etapa === 'confirmarPin') {
            setPrimeiroNovoPin('')
            setEtapa('novoPin')
          }
        } else if (tecla === 'ok') {
          if (etapa === 'novoPin') {
            const problema = problemaNoPin(novoPin) ?? (novoPin === pin ? 'Escolha um PIN diferente do atual.' : null)
            setNovoPin('')
            if (problema) return setErroPin(problema)
            setErroPin('')
            setPrimeiroNovoPin(novoPin)
            setEtapa('confirmarPin')
          } else if (novoPin !== primeiroNovoPin) {
            setErroPin('Os dois PINs não conferem. Digite o novo PIN de novo.')
            setNovoPin('')
            setPrimeiroNovoPin('')
            setEtapa('novoPin')
          } else {
            void salvarPinRef.current(novoPin)
          }
        } else if (novoPin.length < 6) setNovoPin((p) => p + tecla)
      }
    },
    [
      configuracoes,
      etapa,
      matricula,
      pin,
      novoPin,
      primeiroNovoPin,
      modo,
      deslocamento,
      fuso,
      estadoCamera,
      erroCamera,
      reiniciar,
      falhar,
      buscarEspelhos,
      pedirPinPessoal,
    ],
  )

  // Também aceita teclado físico (computador com webcam).
  useEffect(() => {
    const aoTeclar = (e: KeyboardEvent) => {
      if (configuracoes || etapa === 'formulario' || etapa === 'espelho') return
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

  const criandoPin = etapa === 'novoPin' || etapa === 'confirmarPin'
  const podeConfirmar =
    etapa === 'matricula' ? matricula.length > 0 : etapa === 'pin' ? pin.length >= 4 : criandoPin ? novoPin.length >= 4 : false
  const bloqueado = etapa === 'foto' || etapa === 'enviando'
  const hojeLocal = dataLocal(agora, fuso)
  const textoAguarde = salvandoPin
    ? 'Salvando seu PIN...'
    : modo === 'solicitacao'
      ? 'Enviando a solicitação...'
      : modo === 'assinatura'
        ? 'Buscando seus espelhos...'
        : 'Registrando...'
  const titulo =
    etapa === 'novoPin'
      ? modo === 'trocarPin'
        ? 'Digite o novo PIN'
        : 'Crie seu PIN pessoal'
      : etapa === 'confirmarPin'
        ? 'Digite o novo PIN de novo'
        : etapa === 'pin'
          ? modo === 'trocarPin'
            ? 'Digite seu PIN atual'
            : 'Digite seu PIN'
          : etapa === 'enviando' && (salvandoPin || modo === 'assinatura')
            ? textoAguarde
            : modo === 'solicitacao'
              ? 'Esqueceu de bater? Digite sua matrícula'
              : modo === 'assinatura'
                ? 'Assinar espelho: digite sua matrícula'
                : modo === 'trocarPin'
                  ? 'Trocar PIN: digite sua matrícula'
                  : etapa === 'foto'
                    ? 'Olhe para a câmera'
                    : etapa === 'enviando'
                      ? 'Registrando...'
                      : 'Digite sua matrícula'
  const instrucao = criandoPin
    ? erroPin ||
      (etapa === 'confirmarPin'
        ? 'Confirme digitando o mesmo PIN.'
        : modo === 'trocarPin'
          ? '4 a 6 números, sem sequências (1234) nem repetições (1111).'
          : 'Primeiro acesso: o PIN que você recebeu é provisório. Escolha um de 4 a 6 números que só você saiba.')
    : etapa === 'pin'
      ? modo === 'solicitacao'
        ? 'Depois do PIN, informe o dia e o horário que ficou sem marcação.'
        : modo === 'assinatura'
          ? 'Depois do PIN, confira o espelho do mês e assine.'
          : modo === 'trocarPin'
            ? 'Depois, escolha o novo PIN.'
            : 'Ao confirmar, olhe para a câmera: a foto é tirada automaticamente.'
      : bloqueado
        ? modo === 'ponto' && !salvandoPin
          ? 'Fique parado, olhando para a câmera.'
          : 'Aguarde um instante.'
        : 'Matrícula, depois o PIN.'

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
              <LoaderCircle className="girando" aria-hidden /> {textoAguarde}
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
              {criandoPin ? (
                <>
                  <small>Matrícula {matricula} · novo PIN</small>
                  <div className="pontos-pin">
                    {Array.from({ length: Math.max(4, novoPin.length) }, (_, i) => (
                      <span key={i} className={i < novoPin.length ? 'cheio' : ''} />
                    ))}
                  </div>
                </>
              ) : etapa === 'pin' || (bloqueado && pin) ? (
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
            {modo !== 'ponto' || criandoPin ? (
              <button type="button" className="terminal-link" onClick={reiniciar} disabled={bloqueado}>
                Cancelar e voltar ao ponto
              </button>
            ) : (
              etapa === 'matricula' && (
                <div className="terminal-atalhos">
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
                  <button
                    type="button"
                    className="terminal-esqueci"
                    onClick={() => {
                      setMatricula('')
                      setModo('assinatura')
                    }}
                  >
                    <FileSignature size={20} aria-hidden /> Assinar meu espelho
                  </button>
                  <button
                    type="button"
                    className="terminal-esqueci"
                    onClick={() => {
                      setMatricula('')
                      setModo('trocarPin')
                    }}
                  >
                    <KeyRound size={20} aria-hidden /> Trocar meu PIN
                  </button>
                </div>
              )
            )}
            <p className={`terminal-instrucao ${criandoPin && erroPin ? 'terminal-erro' : ''}`}>{instrucao}</p>
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
          {pinPessoalCriado && <small>Seu PIN pessoal foi criado: use-o a partir de agora.</small>}
        </div>
      )}

      {etapa === 'pinDefinido' && (
        <div className="resultado resultado-sucesso" onClick={reiniciar} role="status">
          <KeyRound size={64} aria-hidden />
          <h2>PIN alterado!</h2>
          <p>Use o novo PIN a partir de agora. Ninguém da empresa tem acesso a ele.</p>
          <small>Toque para voltar</small>
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
          {pinPessoalCriado && <small>Seu PIN pessoal foi criado: use-o a partir de agora.</small>}
        </div>
      )}

      {etapa === 'espelho' && espelhos[indiceEspelho] && (
        <ConferenciaEspelho
          key={espelhos[indiceEspelho].id}
          espelho={espelhos[indiceEspelho]}
          restantes={espelhos.length - indiceEspelho - 1}
          ocupado={assinando}
          erro={erroAssinatura}
          aoAssinar={() => void assinar(true)}
          aoContestar={(motivo) => void assinar(false, motivo)}
          aoSair={reiniciar}
        />
      )}

      {etapa === 'assinado' && assinatura && (
        <div
          className={`resultado ${assinatura.status === 'assinado' ? 'resultado-sucesso' : 'resultado-solicitado'}`}
          onClick={continuarAposAssinatura}
          role="status"
        >
          {assinatura.status === 'assinado' ? <FileSignature size={64} aria-hidden /> : <Send size={64} aria-hidden />}
          <h2>{assinatura.status === 'assinado' ? 'Espelho assinado!' : 'Contestação enviada'}</h2>
          <p>
            {assinatura.status === 'assinado'
              ? `Espelho de ${nomeMes(assinatura.mes)} assinado eletronicamente.`
              : `O gestor vai analisar o espelho de ${nomeMes(assinatura.mes)} e enviar uma versão corrigida.`}
          </p>
          <small>Código {assinatura.codigo}</small>
          {indiceEspelho + 1 < espelhos.length && <small>Toque para conferir o próximo espelho.</small>}
        </div>
      )}

      {etapa === 'informacao' && (
        <div className="resultado resultado-solicitado" onClick={reiniciar} role="status">
          <Info size={64} aria-hidden />
          <h2>Tudo em dia</h2>
          <p>{mensagem}</p>
          {pinPessoalCriado && <small>Seu PIN pessoal foi criado: use-o a partir de agora.</small>}
          <small>Toque para voltar</small>
        </div>
      )}

      {etapa === 'erro' && (
        <div className="resultado resultado-erro" onClick={reiniciar} role="alert">
          <CircleAlert size={72} aria-hidden />
          <h2>{modo === 'ponto' ? 'Não foi possível registrar' : 'Não foi possível concluir'}</h2>
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

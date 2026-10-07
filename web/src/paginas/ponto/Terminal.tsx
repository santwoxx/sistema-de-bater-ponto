import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import { api, type ComprovantePonto, type EspelhoParaAssinar } from '../../api'
import { useCamera, useTelaSempreAcesa } from '../../hooks/useCamera'
import { useAgora } from '../../hooks/useColecao'
import { erroDeRede, mensagemErro, pinProvisorio } from '../../lib/erros'
import { problemaNoPin } from '../../lib/pin'
import { somErro, somFoto, somSucesso } from '../../lib/sons'
import { dataLocal } from '../../lib/tempo'
import { gerarId } from '../../lib/util'
import ConferenciaEspelho from './ConferenciaEspelho'
import CameraPonto from './terminal/CameraPonto'
import { AparelhoDesativado, ConfiguracoesAparelho } from './terminal/CicloDoAparelho'
import FormularioSolicitacao from './terminal/FormularioSolicitacao'
import { EspelhoRespondido, FalhaNoAparelho, PinAlterado, PontoRegistrado, SolicitacaoEnviada, TudoEmDia } from './terminal/Resultados'
import TecladoPonto, { type Rodape, type Visor } from './terminal/TecladoPonto'
import { instrucaoDaTela, textoDeEspera, tituloDaTela } from './terminal/textos'
import { ETAPAS_DE_RESULTADO, OUTRO_MOTIVO, PEDIDO_VAZIO, type Etapa, type Modo, type Pedido } from './terminal/tipos'
import TopoTerminal from './terminal/TopoTerminal'
import { useSincronizacao } from './terminal/useSincronizacao'

// Tela do aparelho de ponto: a máquina de estados (etapa + modo) e as chamadas
// ao servidor. A apresentação fica nos componentes da pasta ./terminal.

/** Volta ao início depois de tanto tempo parado em cada situação. */
const INATIVIDADE_MS = 20_000
const FORMULARIO_MS = 90_000
const CONFERENCIA_MS = 3 * 60_000
const RESULTADO_MS = 6_000

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
  const [modo, setModo] = useState<Modo>('ponto')
  const [matricula, setMatricula] = useState('')
  const [pin, setPin] = useState('')
  const [contagem, setContagem] = useState(3)
  const [comprovante, setComprovante] = useState<{ dados: ComprovantePonto; foto: string } | null>(null)
  const [mensagem, setMensagem] = useState('')
  const [configuracoes, setConfiguracoes] = useState(false)
  const [pedido, setPedido] = useState<Pedido>(PEDIDO_VAZIO)
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

  const escolherModo = useCallback((novo: Exclude<Modo, 'ponto'>) => {
    setMatricula('')
    setModo(novo)
  }, [])

  // --- Ações no servidor ----------------------------------------------------

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

  const buscarEspelhos = useCallback(
    async (pinUsado: string) => {
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
    },
    [matricula, falhar, setConectado, pedirPinPessoal],
  )

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

  // --- Tempo ------------------------------------------------------------------

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

  // --- Teclado ----------------------------------------------------------------

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
            setPedido({ ...PEDIDO_VAZIO, data: dataLocal(new Date(Date.now() + deslocamento), fuso) })
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

  // --- Tela ---------------------------------------------------------------------

  if (desativado) return <AparelhoDesativado />

  const criandoPin = etapa === 'novoPin' || etapa === 'confirmarPin'
  const bloqueado = etapa === 'foto' || etapa === 'enviando'
  const podeConfirmar =
    etapa === 'matricula' ? matricula.length > 0 : etapa === 'pin' ? pin.length >= 4 : criandoPin ? novoPin.length >= 4 : false
  const estadoTexto = { etapa, modo, salvandoPin, erroPin }
  const visor: Visor = criandoPin
    ? { tipo: 'pin', legenda: `Matrícula ${matricula} · novo PIN`, digitos: novoPin.length }
    : etapa === 'pin' || (bloqueado && pin)
      ? { tipo: 'pin', legenda: `Matrícula ${matricula}`, digitos: pin.length }
      : { tipo: 'matricula', valor: matricula }
  const rodape: Rodape = modo !== 'ponto' || criandoPin ? 'cancelar' : etapa === 'matricula' ? 'atalhos' : null

  return (
    <div className="terminal">
      <TopoTerminal info={info} agora={agora} fuso={fuso} conectado={conectado} aoAbrirConfiguracoes={() => setConfiguracoes(true)} />

      <div className="terminal-corpo">
        <CameraPonto
          videoRef={videoRef}
          estado={estadoCamera}
          erro={erroCamera}
          aoTentarDeNovo={() => void iniciarCamera()}
          contagem={etapa === 'foto' ? contagem : null}
          aguardando={etapa === 'enviando' ? textoDeEspera(estadoTexto) : null}
        />
        <section className="terminal-painel">
          {etapa === 'formulario' || (etapa === 'enviando' && modo === 'solicitacao') ? (
            <FormularioSolicitacao
              matricula={matricula}
              pedido={pedido}
              aoMudar={setPedido}
              hoje={dataLocal(agora, fuso)}
              erro={erroPedido}
              enviando={etapa === 'enviando'}
              aoEnviar={(e) => void enviarPedido(e)}
              aoCancelar={reiniciar}
            />
          ) : (
            <TecladoPonto
              titulo={tituloDaTela(estadoTexto)}
              visor={visor}
              podeConfirmar={podeConfirmar}
              bloqueado={bloqueado}
              aoTeclar={teclar}
              rodape={rodape}
              aoCancelar={reiniciar}
              aoEscolherModo={escolherModo}
              instrucao={instrucaoDaTela(estadoTexto)}
              instrucaoComErro={criandoPin && erroPin !== ''}
            />
          )}
        </section>
      </div>

      {etapa === 'sucesso' && comprovante && (
        <PontoRegistrado comprovante={comprovante.dados} foto={comprovante.foto} fuso={fuso} pinCriado={pinPessoalCriado} aoFechar={reiniciar} />
      )}
      {etapa === 'pinDefinido' && <PinAlterado aoFechar={reiniciar} />}
      {etapa === 'solicitado' && pedidoEnviado && <SolicitacaoEnviada pedido={pedidoEnviado} pinCriado={pinPessoalCriado} aoFechar={reiniciar} />}
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
        <EspelhoRespondido assinatura={assinatura} temProximo={indiceEspelho + 1 < espelhos.length} aoContinuar={continuarAposAssinatura} />
      )}
      {etapa === 'informacao' && <TudoEmDia mensagem={mensagem} pinCriado={pinPessoalCriado} aoFechar={reiniciar} />}
      {etapa === 'erro' && (
        <FalhaNoAparelho
          titulo={modo === 'ponto' ? 'Não foi possível registrar' : 'Não foi possível concluir'}
          mensagem={mensagem}
          aoFechar={reiniciar}
        />
      )}

      {configuracoes && <ConfiguracoesAparelho empresaId={empresaId} info={info} aoFechar={() => setConfiguracoes(false)} />}
    </div>
  )
}

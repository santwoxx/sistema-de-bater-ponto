import { useCallback, useEffect, useRef, useState } from 'react'
import { api, type ComprovantePonto } from '../../api'
import { useCamera, useTelaSempreAcesa } from '../../hooks/useCamera'
import { useAgora } from '../../hooks/useColecao'
import { credenciaisInvalidas, erroDeRede, mensagemErro, pinProvisorio } from '../../lib/erros'
import { problemaNoPin } from '../../lib/pin'
import { somErro, somFoto, somSucesso } from '../../lib/sons'
import { gerarId } from '../../lib/util'
import CameraPonto from './terminal/CameraPonto'
import { AparelhoDesativado, ConfiguracoesAparelho } from './terminal/CicloDoAparelho'
import { FalhaNoAparelho, PontoGuardado, PontoRegistrado, type DadosGuardada } from './terminal/Resultados'
import { podeGuardar } from './terminal/semInternet'
import TecladoPonto, { type Visor } from './terminal/TecladoPonto'
import { instrucaoDaTela, mensagemCredenciais, textoDeEspera, tituloDaTela } from './terminal/textos'
import { ETAPAS_DE_RESULTADO, type Etapa } from './terminal/tipos'
import TopoTerminal from './terminal/TopoTerminal'
import { useBatidasGuardadas } from './terminal/useBatidasGuardadas'
import { useAtualizacaoAutomatica } from './terminal/useAtualizacaoAutomatica'
import { useSincronizacao } from './terminal/useSincronizacao'

// Tela do aparelho de ponto: o funcionário só bate o ponto (matrícula, PIN e
// foto, com a hora do momento da foto). Solicitações, ajustes e o fechamento
// do mês ficam com o gestor, no painel. Aqui ficam a máquina de estados e as
// chamadas ao servidor; a apresentação fica nos componentes de ./terminal.

/** Volta ao início depois de tanto tempo parado em cada situação. */
const INATIVIDADE_MS = 20_000
const RESULTADO_MS = 6_000

function esperar(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export default function Terminal({ empresaId }: { empresaId: string }) {
  const {
    videoRef,
    estado: estadoCamera,
    mensagem: erroCamera,
    codigo: codigoCamera,
    interno: navegadorInterno,
    tocar: tocarCamera,
    capturar,
    diagnostico: diagnosticoCamera,
  } = useCamera()
  const { info, deslocamento, conectado, desativado, setConectado, conferir } = useSincronizacao(diagnosticoCamera)
  const guardadas = useBatidasGuardadas(conectado, () => setConectado(true))
  const guardarNoAparelho = guardadas.guardar
  useTelaSempreAcesa()
  const agora = new Date(useAgora(1000) + deslocamento)
  const fuso = info?.empresa.fusoHorario ?? 'America/Sao_Paulo'
  // Celular pessoal: só o dono bate ponto aqui; a tela já usa a matrícula dele e pede só o PIN.
  const dono = info?.dispositivo.funcionario ?? null
  const pessoal = dono !== null
  const donoRef = useRef(dono)
  useEffect(() => {
    donoRef.current = dono
  })

  const [etapa, setEtapa] = useState<Etapa>(() => (dono ? 'pin' : 'matricula'))
  const [matricula, setMatricula] = useState(() => dono?.matricula ?? '')
  const [pin, setPin] = useState('')
  const [contagem, setContagem] = useState(3)
  const [comprovante, setComprovante] = useState<{ dados: ComprovantePonto; foto: string } | null>(null)
  const [guardada, setGuardada] = useState<DadosGuardada | null>(null)
  const [mensagem, setMensagem] = useState('')
  const [configuracoes, setConfiguracoes] = useState(false)
  // PIN pessoal: no primeiro uso (PIN provisório do gestor), o funcionário cria o dele e o ponto segue.
  const [novoPin, setNovoPin] = useState('')
  const [primeiroNovoPin, setPrimeiroNovoPin] = useState('')
  const [erroPin, setErroPin] = useState('')
  const [pinPessoalCriado, setPinPessoalCriado] = useState(false)
  const [salvandoPin, setSalvandoPin] = useState(false)

  // Tela parada no início (matrícula; no celular pessoal, o PIN), sem nada digitado.
  const telaInicial = pessoal ? etapa === 'pin' : etapa === 'matricula'
  const ocioso = telaInicial && pin === '' && (pessoal || matricula === '') && !configuracoes
  // Versão nova do site publicada: recarrega com a tela parada.
  useAtualizacaoAutomatica(ocioso && !guardadas.enviando)

  const reiniciar = useCallback(() => {
    const donoAtual = donoRef.current
    setEtapa(donoAtual ? 'pin' : 'matricula')
    setMatricula(donoAtual?.matricula ?? '')
    setPin('')
    setMensagem('')
    setComprovante(null)
    setGuardada(null)
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

  // O servidor recusou o PIN provisório do gestor: o funcionário cria o dele e o ponto continua.
  const pedirPinPessoal = useCallback(() => {
    setNovoPin('')
    setPrimeiroNovoPin('')
    setErroPin('')
    setEtapa('novoPin')
  }, [])

  // O uso do aparelho mudou na sincronização (virou celular pessoal ou da loja):
  // se a tela estava parada, volta ao início certo. Este efeito vem antes do que
  // atualiza ociosoRef, para olhar como a tela estava antes da mudança.
  const ociosoRef = useRef(ocioso)
  const matriculaDono = dono?.matricula ?? null
  useEffect(() => {
    if (ociosoRef.current) reiniciar()
  }, [matriculaDono, reiniciar])
  useEffect(() => {
    ociosoRef.current = ocioso
  })

  /** Mensagem de uma recusa do servidor; matrícula ou PIN errados ganham explicação. */
  const mensagemDaFalha = useCallback(
    (e: unknown, matriculaDigitada: string) => {
      if (!credenciaisInvalidas(e)) return mensagemErro(e)
      // O gestor pode ter mudado o uso do aparelho (celular pessoal ou da loja): confere já.
      conferir()
      return mensagemCredenciais(matriculaDigitada, donoRef.current !== null)
    },
    [conferir],
  )

  const iniciarFoto = useCallback(() => {
    setContagem(3)
    setEtapa('foto')
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

    // Sem internet: a batida fica guardada (cifrada) neste aparelho e vai sozinha
    // quando a conexão voltar. Com o mesmo id: se chegou ao servidor, não duplica.
    const guardarSemInternet = async () => {
      try {
        const resultado = await guardarNoAparelho({ ...dados, dispositivoId: info?.dispositivo.id ?? '' })
        if ('erro' in resultado) return falhar(resultado.erro)
        setGuardada({ matricula, nome: donoRef.current?.nome ?? null, horario: resultado.horario, foto: captura.foto })
        setEtapa('guardado')
        setPin('')
        somSucesso()
      } catch {
        falhar('Estamos sem internet, e não foi possível guardar a batida neste aparelho. Tente de novo quando a conexão voltar.')
      }
    }
    // A última conexão já falhou: guarda direto, sem deixar o funcionário esperando a rede.
    if (!conectado && info && podeGuardar()) return guardarSemInternet()

    try {
      const inicio = Date.now()
      let resultado: ComprovantePonto
      try {
        resultado = await api.registrarPonto(dados)
      } catch (e) {
        // Falha rápida de rede: uma nova tentativa com o mesmo id nunca duplica o registro.
        if (!erroDeRede(e) || Date.now() - inicio > 5000) throw e
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
      if (erroDeRede(e)) {
        setConectado(false)
        if (info && podeGuardar()) return guardarSemInternet()
      }
      falhar(mensagemDaFalha(e, matricula))
    }
  }, [capturar, matricula, pin, falhar, setConectado, pedirPinPessoal, conectado, info, guardarNoAparelho, mensagemDaFalha])

  async function salvarPinPessoal(pinNovo: string) {
    // Foto pequena de quem criou o PIN, como prova (se a câmera estiver disponível).
    const miniatura = estadoCamera === 'pronta' ? (capturar()?.miniatura ?? null) : null
    setSalvandoPin(true)
    setEtapa('enviando')
    try {
      await api.definirPin({ matricula, pin, novoPin: pinNovo, miniatura })
      setConectado(true)
      setNovoPin('')
      setPrimeiroNovoPin('')
      setSalvandoPin(false)
      // Segue para o ponto, já com o PIN novo.
      setPin(pinNovo)
      setPinPessoalCriado(true)
      if (estadoCamera !== 'pronta') falhar(erroCamera || 'Seu PIN foi criado, mas a câmera não está pronta. Tente bater o ponto de novo.')
      else iniciarFoto()
    } catch (e) {
      setSalvandoPin(false)
      if (erroDeRede(e)) setConectado(false)
      falhar(mensagemDaFalha(e, matricula))
    }
  }
  const salvarPinRef = useRef(salvarPinPessoal)
  useEffect(() => {
    salvarPinRef.current = salvarPinPessoal
  })

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
    // No celular pessoal, a matrícula já vem preenchida: só o PIN conta como digitação.
    const digitando = pin !== '' || (!pessoal && matricula !== '')
    const emDigitacao = (etapa === 'matricula' || etapa === 'pin') && digitando
    const criandoPin = etapa === 'novoPin' || etapa === 'confirmarPin'
    const espera = ETAPAS_DE_RESULTADO.includes(etapa) ? RESULTADO_MS : criandoPin ? INATIVIDADE_MS * 2 : emDigitacao ? INATIVIDADE_MS : 0
    if (!espera) return
    const id = setTimeout(reiniciar, espera)
    return () => clearTimeout(id)
  }, [etapa, matricula, pin, novoPin, pessoal, reiniciar])

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
          else if (!donoRef.current) setEtapa('matricula')
        } else if (tecla === 'ok') {
          if (pin.length < 4) return
          if (estadoCamera !== 'pronta') falhar(erroCamera || 'A câmera ainda não está pronta. Aguarde e tente de novo.')
          else iniciarFoto()
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
    [configuracoes, etapa, matricula, pin, novoPin, primeiroNovoPin, estadoCamera, erroCamera, reiniciar, falhar, iniciarFoto],
  )

  // Também aceita teclado físico (computador com webcam).
  useEffect(() => {
    const aoTeclar = (e: KeyboardEvent) => {
      if (configuracoes) return
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
  }, [teclar, reiniciar, configuracoes])

  // --- Tela ---------------------------------------------------------------------

  if (desativado) return <AparelhoDesativado />

  const criandoPin = etapa === 'novoPin' || etapa === 'confirmarPin'
  // Na hora da foto (e enquanto envia), nada pode ser digitado; com o aparelho
  // em pé, a câmera ocupa a tela toda (ver estilos.css).
  const bloqueado = etapa === 'foto' || etapa === 'enviando'
  const podeConfirmar =
    etapa === 'matricula' ? matricula.length > 0 : etapa === 'pin' ? pin.length >= 4 : criandoPin ? novoPin.length >= 4 : false
  const estadoTexto = { etapa, salvandoPin, erroPin, nomeDono: dono?.nome ?? null }
  const quem = dono ? dono.nome : `Matrícula ${matricula}`
  const visor: Visor = criandoPin
    ? { tipo: 'pin', legenda: `${quem} · novo PIN`, digitos: novoPin.length }
    : etapa === 'pin' || (bloqueado && pin)
      ? { tipo: 'pin', legenda: quem, digitos: pin.length }
      : { tipo: 'matricula', valor: matricula }

  return (
    <div className={bloqueado ? 'terminal terminal-capturando' : 'terminal'}>
      <TopoTerminal
        info={info}
        agora={agora}
        fuso={fuso}
        conectado={conectado}
        guardadas={guardadas.pendentes}
        enviandoGuardadas={guardadas.enviando}
        aoAbrirConfiguracoes={() => setConfiguracoes(true)}
      />
      {guardadas.aviso && (
        <div className={`terminal-faixa${guardadas.aviso.tipo === 'ok' ? ' terminal-faixa-ok' : ''}`} role="status">
          {guardadas.aviso.texto}
        </div>
      )}

      <div className="terminal-corpo">
        <CameraPonto
          videoRef={videoRef}
          estado={estadoCamera}
          mensagem={erroCamera}
          codigo={codigoCamera}
          interno={navegadorInterno}
          aoTocar={tocarCamera}
          contagem={etapa === 'foto' ? contagem : null}
          aguardando={etapa === 'enviando' ? textoDeEspera(salvandoPin) : null}
        />
        <section className="terminal-painel">
          <TecladoPonto
            titulo={tituloDaTela(estadoTexto)}
            visor={visor}
            podeConfirmar={podeConfirmar}
            bloqueado={bloqueado}
            aoTeclar={teclar}
            aoCancelar={criandoPin ? reiniciar : null}
            instrucao={instrucaoDaTela(estadoTexto)}
            instrucaoComErro={criandoPin && erroPin !== ''}
          />
        </section>
      </div>

      {etapa === 'sucesso' && comprovante && (
        <PontoRegistrado comprovante={comprovante.dados} foto={comprovante.foto} fuso={fuso} pinCriado={pinPessoalCriado} aoFechar={reiniciar} />
      )}
      {etapa === 'guardado' && guardada && <PontoGuardado guardada={guardada} fuso={fuso} aoFechar={reiniciar} />}
      {etapa === 'erro' && <FalhaNoAparelho mensagem={mensagem} aoFechar={reiniciar} />}

      {configuracoes && (
        <ConfiguracoesAparelho empresaId={empresaId} info={info} guardadas={guardadas.pendentes} aoFechar={() => setConfiguracoes(false)} />
      )}
    </div>
  )
}

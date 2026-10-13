import { useCallback, useEffect, useRef, useState } from 'react'
import { api, type ComprovantePonto } from '../../api'
import { useCamera, useTelaSempreAcesa } from '../../hooks/useCamera'
import { useAgora } from '../../hooks/useAgora'
import { credenciaisInvalidas, erroDeRede, mensagemErro } from '../../lib/erros'
import { TAMANHO_PIN } from '../../lib/pin'
import { somErro, somFoto, somSucesso } from '../../lib/sons'
import { gerarId } from '../../lib/util'
import CameraPonto from './terminal/CameraPonto'
import { AparelhoDesativado, ConfiguracoesAparelho } from './terminal/CicloDoAparelho'
import { FalhaNoAparelho, PontoGuardado, PontoRegistrado, type DadosGuardada } from './terminal/Resultados'
import { podeGuardar } from './terminal/semInternet'
import TecladoPonto, { type Visor } from './terminal/TecladoPonto'
import { instrucaoDaTela, PIN_INCORRETO, tituloDaTela } from './terminal/textos'
import { ETAPAS_DE_RESULTADO, type Etapa } from './terminal/tipos'
import TopoTerminal from './terminal/TopoTerminal'
import { useBatidasGuardadas } from './terminal/useBatidasGuardadas'
import { useAtualizacaoAutomatica } from './terminal/useAtualizacaoAutomatica'
import { useSincronizacao } from './terminal/useSincronizacao'

// Tela do aparelho de ponto: o funcionário só bate o ponto, digitando o PIN de
// 4 números (definido pelo gestor, um para cada funcionário); o servidor sabe
// quem é pelo PIN. No celular pessoal, só vale o PIN do dono. A hora é a do
// momento da foto. Solicitações, ajustes, PIN e o fechamento do mês ficam com o
// gestor, no painel. Aqui ficam a máquina de estados e as chamadas ao servidor;
// a apresentação fica em ./terminal.

/** Volta ao início depois de tanto tempo parado em cada situação. */
const INATIVIDADE_MS = 20_000
const RESULTADO_MS = 6_000
/** Uma cópia aberta da função de ponto fica disponível por alguns minutos sem uso. */
const AQUECER_A_CADA_MS = 4 * 60_000

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
  // Celular pessoal: o aparelho já sabe quem é o dono, e a tela o cumprimenta.
  const nomeDono = info?.dispositivo.funcionario?.nome ?? null

  const [etapa, setEtapa] = useState<Etapa>('pin')
  const [pin, setPin] = useState('')
  const [contagem, setContagem] = useState(3)
  const [comprovante, setComprovante] = useState<{ dados: ComprovantePonto; foto: string } | null>(null)
  const [guardada, setGuardada] = useState<DadosGuardada | null>(null)
  const [mensagem, setMensagem] = useState('')
  const [configuracoes, setConfiguracoes] = useState(false)

  // Tela parada no início, sem nada digitado.
  const ocioso = etapa === 'pin' && pin === '' && !configuracoes
  // Versão nova do site publicada: recarrega com a tela parada.
  useAtualizacaoAutomatica(ocioso && !guardadas.enviando)

  const reiniciar = useCallback(() => {
    setEtapa('pin')
    setPin('')
    setMensagem('')
    setComprovante(null)
    setGuardada(null)
  }, [])

  const falhar = useCallback((texto: string) => {
    setMensagem(texto)
    setEtapa('erro')
    setPin('')
    somErro()
  }, [])

  /** Mensagem de uma recusa do servidor. */
  const mensagemDaFalha = useCallback(
    (e: unknown) => {
      if (!credenciaisInvalidas(e)) return mensagemErro(e)
      // O gestor pode ter mudado o uso do aparelho (celular pessoal ou da loja): confere já.
      conferir()
      return PIN_INCORRETO
    },
    [conferir],
  )

  // --- Ação no servidor ----------------------------------------------------

  const enviar = useCallback(async () => {
    const captura = capturar()
    if (!captura) {
      falhar('Não foi possível tirar a foto. Verifique a câmera e tente de novo.')
      return
    }
    somFoto()
    setEtapa('enviando')
    const dados = { idRequisicao: gerarId(), pin, foto: captura.foto, miniatura: captura.miniatura }

    // Sem internet: a batida fica guardada (cifrada) neste aparelho e vai sozinha
    // quando a conexão voltar. Com o mesmo id: se chegou ao servidor, não duplica.
    const guardarSemInternet = async () => {
      try {
        const resultado = await guardarNoAparelho({ ...dados, dispositivoId: info?.dispositivo.id ?? '' })
        if ('erro' in resultado) return falhar(resultado.erro)
        setGuardada({ quem: nomeDono, horario: resultado.horario, foto: captura.foto })
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
      if (erroDeRede(e)) {
        setConectado(false)
        if (info && podeGuardar()) return guardarSemInternet()
      }
      falhar(mensagemDaFalha(e))
    }
  }, [capturar, pin, falhar, setConectado, conectado, info, nomeDono, guardarNoAparelho, mensagemDaFalha])

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

  // Volta ao início com algo digitado pela metade ou depois de mostrar o resultado.
  useEffect(() => {
    const digitando = etapa === 'pin' && pin !== ''
    const espera = ETAPAS_DE_RESULTADO.includes(etapa) ? RESULTADO_MS : digitando ? INATIVIDADE_MS : 0
    if (!espera) return
    const id = setTimeout(reiniciar, espera)
    return () => clearTimeout(id)
  }, [etapa, pin, reiniciar])

  // --- Teclado ----------------------------------------------------------------

  // Alguém começou a digitar: abre a função de ponto no servidor enquanto a pessoa
  // digita o PIN, para a batida não esperar a partida a frio (~1 s).
  const ultimoAquecimento = useRef(0)
  const aquecer = useCallback(() => {
    if (!conectado || Date.now() - ultimoAquecimento.current < AQUECER_A_CADA_MS) return
    ultimoAquecimento.current = Date.now()
    api.aquecerPonto().catch(() => undefined)
  }, [conectado])

  const teclar = useCallback(
    (tecla: string) => {
      if (configuracoes) return
      if (/^\d$/.test(tecla) && pin === '') aquecer()
      if (ETAPAS_DE_RESULTADO.includes(etapa)) {
        reiniciar()
        return
      }
      if (etapa === 'pin') {
        if (tecla === 'apagar') setPin((p) => p.slice(0, -1))
        else if (tecla === 'ok') {
          if (pin.length < TAMANHO_PIN) return
          if (estadoCamera !== 'pronta') falhar(erroCamera || 'A câmera ainda não está pronta. Aguarde e tente de novo.')
          else {
            setContagem(3)
            setEtapa('foto')
          }
        } else if (pin.length < TAMANHO_PIN) setPin((p) => p + tecla)
      }
    },
    [configuracoes, etapa, pin, estadoCamera, erroCamera, reiniciar, falhar, aquecer],
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

  // Na hora da foto (e enquanto envia), nada pode ser digitado; com o aparelho
  // em pé, a câmera ocupa a tela toda (ver estilos.css).
  const bloqueado = etapa === 'foto' || etapa === 'enviando'
  const visor: Visor = { legenda: nomeDono, digitos: pin.length }
  const podeConfirmar = etapa === 'pin' && pin.length === TAMANHO_PIN

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
          aguardando={etapa === 'enviando' ? 'Registrando...' : null}
        />
        <section className="terminal-painel">
          <TecladoPonto
            titulo={tituloDaTela(etapa, nomeDono)}
            visor={visor}
            podeConfirmar={podeConfirmar}
            bloqueado={bloqueado}
            aoTeclar={teclar}
            instrucao={instrucaoDaTela(etapa)}
          />
        </section>
      </div>

      {etapa === 'sucesso' && comprovante && (
        <PontoRegistrado comprovante={comprovante.dados} foto={comprovante.foto} fuso={fuso} aoFechar={reiniciar} />
      )}
      {etapa === 'guardado' && guardada && <PontoGuardado guardada={guardada} fuso={fuso} aoFechar={reiniciar} />}
      {etapa === 'erro' && <FalhaNoAparelho mensagem={mensagem} aoFechar={reiniciar} />}

      {configuracoes && (
        <ConfiguracoesAparelho empresaId={empresaId} info={info} guardadas={guardadas.pendentes} aoFechar={() => setConfiguracoes(false)} />
      )}
    </div>
  )
}

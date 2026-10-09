import { useCallback, useEffect, useRef, useState } from 'react'
import { api, type ComprovantePonto } from '../../api'
import { useCamera, useTelaSempreAcesa } from '../../hooks/useCamera'
import { useAgora } from '../../hooks/useColecao'
import { credenciaisInvalidas, erroDeRede, mensagemErro } from '../../lib/erros'
import { cpfValido, mascararCpf } from '../../lib/formatos'
import { TAMANHO_PIN } from '../../lib/pin'
import { somErro, somFoto, somSucesso } from '../../lib/sons'
import { gerarId } from '../../lib/util'
import CameraPonto from './terminal/CameraPonto'
import { AparelhoDesativado, ConfiguracoesAparelho } from './terminal/CicloDoAparelho'
import { FalhaNoAparelho, PontoGuardado, PontoRegistrado, type DadosGuardada } from './terminal/Resultados'
import { podeGuardar } from './terminal/semInternet'
import TecladoPonto, { type Visor } from './terminal/TecladoPonto'
import { instrucaoDaTela, mensagemRecusa, TAMANHO_CPF, tituloDaTela } from './terminal/textos'
import { ETAPAS_DE_RESULTADO, type Etapa } from './terminal/tipos'
import TopoTerminal from './terminal/TopoTerminal'
import { useBatidasGuardadas } from './terminal/useBatidasGuardadas'
import { useAtualizacaoAutomatica } from './terminal/useAtualizacaoAutomatica'
import { useSincronizacao } from './terminal/useSincronizacao'

// Tela do aparelho de ponto: o funcionário só bate o ponto. No aparelho da
// loja, digita o CPF e o PIN de 4 números (definido pelo gestor); no celular
// pessoal, só o PIN. A hora é a do momento da foto. Solicitações, ajustes, PIN
// e o fechamento do mês ficam com o gestor, no painel. Aqui ficam a máquina de
// estados e as chamadas ao servidor; a apresentação fica em ./terminal.

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
  // Celular pessoal: o aparelho já sabe quem é o dono; a tela o cumprimenta e pede só o PIN.
  const nomeDono = info?.dispositivo.funcionario?.nome ?? null
  const pessoal = nomeDono !== null
  const pessoalRef = useRef(pessoal)
  useEffect(() => {
    pessoalRef.current = pessoal
  })

  const [etapa, setEtapa] = useState<Etapa>(() => (pessoal ? 'pin' : 'cpf'))
  const [cpf, setCpf] = useState('')
  const [erroCpf, setErroCpf] = useState('')
  const [pin, setPin] = useState('')
  const [contagem, setContagem] = useState(3)
  const [comprovante, setComprovante] = useState<{ dados: ComprovantePonto; foto: string } | null>(null)
  const [guardada, setGuardada] = useState<DadosGuardada | null>(null)
  const [mensagem, setMensagem] = useState('')
  const [configuracoes, setConfiguracoes] = useState(false)

  // Tela parada no início (CPF; no celular pessoal, o PIN), sem nada digitado.
  const ocioso = etapa === (pessoal ? 'pin' : 'cpf') && cpf === '' && pin === '' && !configuracoes
  // Versão nova do site publicada: recarrega com a tela parada.
  useAtualizacaoAutomatica(ocioso && !guardadas.enviando)

  const reiniciar = useCallback(() => {
    setEtapa(pessoalRef.current ? 'pin' : 'cpf')
    setCpf('')
    setErroCpf('')
    setPin('')
    setMensagem('')
    setComprovante(null)
    setGuardada(null)
  }, [])

  // O uso do aparelho mudou na sincronização (virou celular pessoal ou da loja):
  // se a tela estava parada, volta ao início certo. Este efeito vem antes do que
  // atualiza ociosoRef, para olhar como a tela estava antes da mudança.
  const ociosoRef = useRef(ocioso)
  useEffect(() => {
    if (ociosoRef.current) reiniciar()
  }, [pessoal, reiniciar])
  useEffect(() => {
    ociosoRef.current = ocioso
  })

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
      return mensagemRecusa(pessoalRef.current)
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
    // No celular pessoal, o servidor sabe quem é pelo aparelho: vai só o PIN.
    const dados = { idRequisicao: gerarId(), ...(pessoal ? {} : { cpf }), pin, foto: captura.foto, miniatura: captura.miniatura }

    // Sem internet: a batida fica guardada (cifrada) neste aparelho e vai sozinha
    // quando a conexão voltar. Com o mesmo id: se chegou ao servidor, não duplica.
    const guardarSemInternet = async () => {
      try {
        const resultado = await guardarNoAparelho({ ...dados, dispositivoId: info?.dispositivo.id ?? '' })
        if ('erro' in resultado) return falhar(resultado.erro)
        setGuardada({ quem: nomeDono ?? `CPF ${mascararCpf(cpf)}`, horario: resultado.horario, foto: captura.foto })
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
  }, [capturar, pessoal, cpf, pin, falhar, setConectado, conectado, info, nomeDono, guardarNoAparelho, mensagemDaFalha])

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
    const digitando = (etapa === 'cpf' || etapa === 'pin') && (cpf !== '' || pin !== '')
    const espera = ETAPAS_DE_RESULTADO.includes(etapa) ? RESULTADO_MS : digitando ? INATIVIDADE_MS : 0
    if (!espera) return
    const id = setTimeout(reiniciar, espera)
    return () => clearTimeout(id)
  }, [etapa, cpf, pin, reiniciar])

  // --- Teclado ----------------------------------------------------------------

  const teclar = useCallback(
    (tecla: string) => {
      if (configuracoes) return
      if (ETAPAS_DE_RESULTADO.includes(etapa)) {
        reiniciar()
        return
      }
      if (etapa === 'cpf') {
        setErroCpf('')
        if (tecla === 'apagar') setCpf((c) => c.slice(0, -1))
        else if (tecla === 'ok') {
          if (cpf.length < TAMANHO_CPF) return
          // Confere os dígitos do CPF aqui mesmo: um erro de digitação não chega ao servidor.
          if (cpfValido(cpf)) setEtapa('pin')
          else setErroCpf('CPF inválido. Confira os números e corrija.')
        } else if (cpf.length < TAMANHO_CPF) setCpf((c) => c + tecla)
      } else if (etapa === 'pin') {
        if (tecla === 'apagar') {
          if (pin) setPin((p) => p.slice(0, -1))
          else if (!pessoal) setEtapa('cpf')
        } else if (tecla === 'ok') {
          if (pin.length < TAMANHO_PIN) return
          if (estadoCamera !== 'pronta') falhar(erroCamera || 'A câmera ainda não está pronta. Aguarde e tente de novo.')
          else {
            setContagem(3)
            setEtapa('foto')
          }
        } else if (pin.length < TAMANHO_PIN) setPin((p) => p + tecla)
      }
    },
    [configuracoes, etapa, cpf, pin, pessoal, estadoCamera, erroCamera, reiniciar, falhar],
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
  const visor: Visor =
    etapa === 'cpf' ? { tipo: 'cpf', digitos: cpf } : { tipo: 'pin', legenda: nomeDono ?? (cpf ? `CPF ${mascararCpf(cpf)}` : null), digitos: pin.length }
  const podeConfirmar = etapa === 'cpf' ? cpf.length === TAMANHO_CPF : etapa === 'pin' && pin.length === TAMANHO_PIN

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
            erro={etapa === 'cpf' ? erroCpf : ''}
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

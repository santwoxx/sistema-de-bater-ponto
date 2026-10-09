import { CircleAlert, CircleCheck, CloudOff, FileSignature, Info, KeyRound, Send } from 'lucide-react'
import type { ReactNode } from 'react'
import type { ComprovantePonto } from '../../../api'
import { formatarNsr } from '../../../lib/formatos'
import { dataPorExtenso, formatarData, horaLocal, nomeMes } from '../../../lib/tempo'

// Telas de resultado do aparelho: cobrem a tela, somem sozinhas depois de
// alguns segundos (ver Terminal) ou com um toque.

function Resultado({
  estilo,
  aoTocar,
  alerta = false,
  children,
}: {
  estilo: 'sucesso' | 'solicitado' | 'erro'
  aoTocar: () => void
  alerta?: boolean
  children: ReactNode
}) {
  return (
    <div className={`resultado resultado-${estilo}`} onClick={aoTocar} role={alerta ? 'alert' : 'status'}>
      {children}
    </div>
  )
}

function AvisoPinCriado({ mostrar }: { mostrar: boolean }) {
  return mostrar ? <small>Seu PIN pessoal foi criado: use-o a partir de agora.</small> : null
}

export function PontoRegistrado({
  comprovante,
  foto,
  fuso,
  pinCriado,
  aoFechar,
}: {
  comprovante: ComprovantePonto
  foto: string
  fuso: string
  pinCriado: boolean
  aoFechar: () => void
}) {
  return (
    <Resultado estilo="sucesso" aoTocar={aoFechar}>
      <CircleCheck size={72} aria-hidden />
      <h2>Ponto registrado!</h2>
      <img src={foto} alt="" className="resultado-foto" />
      <strong className="resultado-nome">{comprovante.funcionarioNome}</strong>
      <span className={`resultado-tipo resultado-${comprovante.tipo}`}>
        {comprovante.tipo === 'entrada' ? 'Entrada' : 'Saída'} · {comprovante.ordinal}ª marcação do dia
      </span>
      <span className="resultado-hora">{comprovante.horaLocal}</span>
      <span>{dataPorExtenso(new Date(comprovante.dataHora), fuso)}</span>
      <small>
        NSR {formatarNsr(comprovante.nsr)} · Código {comprovante.codigoVerificacao}
      </small>
      <AvisoPinCriado mostrar={pinCriado} />
    </Resultado>
  )
}

/** Batida feita sem internet (nome: dono do celular pessoal, se for o caso). */
export interface DadosGuardada {
  matricula: string
  nome: string | null
  horario: number
  foto: string
}

/** Batida feita sem internet: guardada no aparelho, vai sozinha quando a conexão voltar. */
export function PontoGuardado({
  guardada,
  fuso,
  aoFechar,
}: {
  guardada: DadosGuardada
  fuso: string
  aoFechar: () => void
}) {
  const horario = new Date(guardada.horario)
  return (
    <Resultado estilo="solicitado" aoTocar={aoFechar}>
      <CloudOff size={64} aria-hidden />
      <h2>Batida guardada</h2>
      <img src={guardada.foto} alt="" className="resultado-foto" />
      <strong className="resultado-nome">{guardada.nome ?? `Matrícula ${guardada.matricula}`}</strong>
      <span className="resultado-hora">{horaLocal(horario, fuso)}</span>
      <span>{dataPorExtenso(horario, fuso)}</span>
      <p>Estamos sem internet. A batida ficou guardada neste aparelho e vai sozinha quando a conexão voltar; o PIN é conferido nessa hora.</p>
    </Resultado>
  )
}

export function PinAlterado({ aoFechar }: { aoFechar: () => void }) {
  return (
    <Resultado estilo="sucesso" aoTocar={aoFechar}>
      <KeyRound size={64} aria-hidden />
      <h2>PIN alterado!</h2>
      <p>Use o novo PIN a partir de agora. Ninguém da empresa tem acesso a ele.</p>
      <small>Toque para voltar</small>
    </Resultado>
  )
}

export function SolicitacaoEnviada({
  pedido,
  pinCriado,
  aoFechar,
}: {
  pedido: { funcionarioNome: string; data: string; hora: string }
  pinCriado: boolean
  aoFechar: () => void
}) {
  return (
    <Resultado estilo="solicitado" aoTocar={aoFechar}>
      <Send size={64} aria-hidden />
      <h2>Solicitação enviada!</h2>
      <strong className="resultado-nome">{pedido.funcionarioNome}</strong>
      <p>
        Marcação de {formatarData(pedido.data)} às {pedido.hora}
      </p>
      <small>Ela passa a valer depois que o gestor aprovar.</small>
      <AvisoPinCriado mostrar={pinCriado} />
    </Resultado>
  )
}

export function EspelhoRespondido({
  assinatura,
  temProximo,
  aoContinuar,
}: {
  assinatura: { status: 'assinado' | 'contestado'; mes: string; codigo: string }
  temProximo: boolean
  aoContinuar: () => void
}) {
  const assinado = assinatura.status === 'assinado'
  return (
    <Resultado estilo={assinado ? 'sucesso' : 'solicitado'} aoTocar={aoContinuar}>
      {assinado ? <FileSignature size={64} aria-hidden /> : <Send size={64} aria-hidden />}
      <h2>{assinado ? 'Espelho assinado!' : 'Contestação enviada'}</h2>
      <p>
        {assinado
          ? `Espelho de ${nomeMes(assinatura.mes)} assinado eletronicamente.`
          : `O gestor vai analisar o espelho de ${nomeMes(assinatura.mes)} e enviar uma versão corrigida.`}
      </p>
      <small>Código {assinatura.codigo}</small>
      {temProximo && <small>Toque para conferir o próximo espelho.</small>}
    </Resultado>
  )
}

export function TudoEmDia({ mensagem, pinCriado, aoFechar }: { mensagem: string; pinCriado: boolean; aoFechar: () => void }) {
  return (
    <Resultado estilo="solicitado" aoTocar={aoFechar}>
      <Info size={64} aria-hidden />
      <h2>Tudo em dia</h2>
      <p>{mensagem}</p>
      <AvisoPinCriado mostrar={pinCriado} />
      <small>Toque para voltar</small>
    </Resultado>
  )
}

export function FalhaNoAparelho({ titulo, mensagem, aoFechar }: { titulo: string; mensagem: string; aoFechar: () => void }) {
  return (
    <Resultado estilo="erro" aoTocar={aoFechar} alerta>
      <CircleAlert size={72} aria-hidden />
      <h2>{titulo}</h2>
      <p>{mensagem}</p>
      <small>Toque para tentar de novo</small>
    </Resultado>
  )
}

import { CircleAlert, CircleCheck, CloudOff } from 'lucide-react'
import type { ReactNode } from 'react'
import type { ComprovantePonto } from '../../../api'
import { formatarNsr } from '../../../lib/formatos'
import { dataPorExtenso, horaLocal } from '../../../lib/tempo'

// Telas de resultado do aparelho (ponto registrado, guardado sem internet ou
// recusado): cobrem a tela e somem sozinhas depois de alguns segundos (ver
// Terminal) ou com um toque.

function Resultado({
  estilo,
  aoTocar,
  alerta = false,
  children,
}: {
  estilo: 'sucesso' | 'aviso' | 'erro'
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
    <Resultado estilo="aviso" aoTocar={aoFechar}>
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

export function FalhaNoAparelho({ mensagem, aoFechar }: { mensagem: string; aoFechar: () => void }) {
  return (
    <Resultado estilo="erro" aoTocar={aoFechar} alerta>
      <CircleAlert size={72} aria-hidden />
      <h2>Não foi possível registrar</h2>
      <p>{mensagem}</p>
      <small>Toque para tentar de novo</small>
    </Resultado>
  )
}

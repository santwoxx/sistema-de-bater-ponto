import { useState } from 'react'
import { api } from '../api'
import { mensagemErro } from '../lib/erros'
import { formatarDataHora } from '../lib/tempo'
import type { Empresa, EspelhoFechado } from '../tipos'
import { Aviso, Campo, Selo } from './Basicos'
import Modal from './Modal'
import { useNotificar } from './Notificacoes'

// Espelho fechado: a versão congelada do mês, que o gestor imprime para o
// funcionário assinar em papel. Se algo mudou depois, reabre com motivo e uma
// nova versão é gerada (a anterior fica guardada).

export function SeloEspelho({ espelho }: { espelho: EspelhoFechado | undefined }) {
  return espelho ? <Selo cor="verde">Fechado</Selo> : <Selo>Não fechado</Selo>
}

/** Quando e por quem o mês foi fechado (e o motivo da última reabertura). */
export function BlocoFechamento({ espelho, empresa }: { espelho: EspelhoFechado; empresa: Empresa }) {
  const quando = espelho.fechadoEm ? formatarDataHora(espelho.fechadoEm.toDate(), empresa.fusoHorario) : '—'
  return (
    <div>
      <SeloEspelho espelho={espelho} />
      <p>
        Mês fechado em {quando} por {espelho.fechadoPor.nome}
        {espelho.versao > 1 && ` (versão ${espelho.versao}${espelho.reabertura ? `: ${espelho.reabertura.motivo}` : ''})`}. Imprima o
        espelho para o funcionário assinar.
      </p>
    </div>
  )
}

export function ModalReabrir({
  empresa,
  mes,
  funcionario,
  aoFechar,
}: {
  empresa: Empresa
  mes: string
  funcionario: { id: string; nome: string }
  aoFechar: () => void
}) {
  const notificar = useNotificar()
  const [motivo, setMotivo] = useState('')
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState('')

  async function confirmar() {
    setErro('')
    if (motivo.trim().length < 5) return setErro('Explique o motivo (mínimo de 5 caracteres). Ele fica registrado na auditoria.')
    setSalvando(true)
    try {
      const { resultados } = await api.fecharEspelhos({
        empresaId: empresa.id,
        mes,
        funcionarioIds: [funcionario.id],
        motivoReabertura: motivo.trim(),
      })
      const semMudanca = resultados[0]?.resultado === 'sem-alteracoes'
      notificar(
        semMudanca ? 'Nada mudou desde o fechamento: o espelho fechado continua valendo.' : 'Nova versão gerada. Imprima de novo para a assinatura.',
        semMudanca ? 'info' : 'sucesso',
      )
      aoFechar()
    } catch (e) {
      setErro(mensagemErro(e))
    } finally {
      setSalvando(false)
    }
  }

  return (
    <Modal
      titulo="Reabrir espelho fechado"
      largura="pequena"
      aoFechar={aoFechar}
      aoEnviar={confirmar}
      rodape={
        <>
          <button type="button" className="botao fantasma" onClick={aoFechar} disabled={salvando}>
            Cancelar
          </button>
          <button type="submit" className="botao primario" disabled={salvando}>
            {salvando ? 'Gerando...' : 'Gerar nova versão'}
          </button>
        </>
      }
    >
      <p>
        O espelho de {funcionario.nome} já foi fechado (e pode já ter sido impresso e assinado). Uma nova versão será calculada com as
        marcações atuais; a anterior fica guardada no histórico. Depois, imprima de novo para a assinatura.
      </p>
      <Campo rotulo="Motivo">
        <textarea rows={3} value={motivo} onChange={(e) => setMotivo(e.target.value)} maxLength={300} autoFocus />
      </Campo>
      {erro && <Aviso tipo="erro">{erro}</Aviso>}
    </Modal>
  )
}

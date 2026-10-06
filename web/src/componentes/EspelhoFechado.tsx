import { useState } from 'react'
import { api } from '../api'
import { mensagemErro } from '../lib/erros'
import { formatarDataHora } from '../lib/tempo'
import type { Empresa, EspelhoFechado } from '../tipos'
import { Aviso, Campo, Selo } from './Basicos'
import Modal from './Modal'
import { useNotificar } from './Notificacoes'

export function SeloEspelho({ espelho }: { espelho: EspelhoFechado | undefined }) {
  if (!espelho) return <Selo>Não fechado</Selo>
  if (espelho.status === 'assinado') return <Selo cor="verde">Assinado</Selo>
  if (espelho.status === 'contestado') return <Selo cor="vermelho">Contestado</Selo>
  return <Selo cor="amarelo">Aguardando assinatura</Selo>
}

/** Resumo do fechamento e da assinatura de um espelho (tela e impressão). */
export function BlocoAssinatura({ espelho, empresa }: { espelho: EspelhoFechado; empresa: Empresa }) {
  const quando = (em: EspelhoFechado['fechadoEm']) => (em ? formatarDataHora(em.toDate(), empresa.fusoHorario) : '—')
  return (
    <div className="bloco-assinatura">
      {(espelho.assinatura ?? espelho.contestacao)?.miniatura && (
        <img src={(espelho.assinatura ?? espelho.contestacao)!.miniatura!} alt="Foto do funcionário no momento da assinatura" />
      )}
      <div>
        <SeloEspelho espelho={espelho} />
        <p>
          Mês fechado em {quando(espelho.fechadoEm)} por {espelho.fechadoPor.nome}
          {espelho.versao > 1 && ` (versão ${espelho.versao}${espelho.reabertura ? `: ${espelho.reabertura.motivo}` : ''})`}.
        </p>
        {espelho.assinatura && (
          <p>
            <strong>Assinado eletronicamente</strong> por {espelho.funcionario.nome} em {quando(espelho.assinatura.em)}, no aparelho "
            {espelho.assinatura.dispositivoNome}", com matrícula, PIN pessoal e foto. Código de verificação{' '}
            <strong className="numeros">{espelho.assinatura.codigo}</strong>.
          </p>
        )}
        {espelho.contestacao && (
          <p>
            <strong>Contestado</strong> por {espelho.funcionario.nome} em {quando(espelho.contestacao.em)}: {espelho.contestacao.motivo}
          </p>
        )}
        {espelho.status === 'aguardando' && <p>Aguardando o funcionário conferir e assinar no aparelho de ponto.</p>}
      </div>
    </div>
  )
}

export function ModalReabrir({
  empresa,
  mes,
  funcionario,
  espelho,
  aoFechar,
}: {
  empresa: Empresa
  mes: string
  funcionario: { id: string; nome: string }
  espelho: EspelhoFechado
  aoFechar: () => void
}) {
  const notificar = useNotificar()
  const [motivo, setMotivo] = useState('')
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState('')
  const contestado = espelho.status === 'contestado'

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
        semMudanca ? 'Nada mudou desde a assinatura: o espelho assinado continua valendo.' : 'Nova versão enviada para o funcionário assinar.',
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
      titulo={contestado ? 'Reenviar espelho para assinatura' : 'Reabrir espelho assinado'}
      largura="pequena"
      aoFechar={aoFechar}
      aoEnviar={confirmar}
      rodape={
        <>
          <button type="button" className="botao fantasma" onClick={aoFechar} disabled={salvando}>
            Cancelar
          </button>
          <button type="submit" className="botao primario" disabled={salvando}>
            {salvando ? 'Enviando...' : 'Gerar nova versão'}
          </button>
        </>
      }
    >
      <p>
        {contestado ? (
          <>
            {funcionario.nome} contestou o espelho: <em>{espelho.contestacao?.motivo}</em>. Corrija as marcações (inclua, desconsidere ou
            abone) e gere uma nova versão para ele assinar.
          </>
        ) : (
          <>
            O espelho de {funcionario.nome} já foi assinado. Uma nova versão será calculada com as marcações atuais e enviada para nova
            assinatura. A versão assinada fica guardada no histórico.
          </>
        )}
      </p>
      <Campo rotulo="Motivo">
        <textarea rows={3} value={motivo} onChange={(e) => setMotivo(e.target.value)} maxLength={300} autoFocus />
      </Campo>
      {erro && <Aviso tipo="erro">{erro}</Aviso>}
    </Modal>
  )
}

import { Trash2 } from 'lucide-react'
import { useState } from 'react'
import { api } from '../api'
import { mensagemErro } from '../lib/erros'
import { formatarData, formatarDataHora, hhmmParaMinutos, minutosParaHHMM } from '../lib/tempo'
import { ROTULOS_ABONO, type Abono, type Empresa, type Funcionario, type TipoAbono } from '../tipos'
import { Aviso, Campo } from './Basicos'
import Modal from './Modal'
import { useNotificar } from './Notificacoes'

const TIPOS = Object.keys(ROTULOS_ABONO) as TipoAbono[]

export function ModalAbono({
  empresa,
  funcionario,
  dataInicial,
  aoFechar,
}: {
  empresa: Empresa
  funcionario: Funcionario
  dataInicial: string
  aoFechar: () => void
}) {
  const notificar = useNotificar()
  const [tipo, setTipo] = useState<TipoAbono>('atestado')
  const [descricao, setDescricao] = useState('')
  const [de, setDe] = useState(dataInicial)
  const [ate, setAte] = useState(dataInicial)
  const [todos, setTodos] = useState(false)
  const [diaInteiro, setDiaInteiro] = useState(true)
  const [horas, setHoras] = useState('02:00')
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState('')

  async function salvar() {
    setErro('')
    if (descricao.trim().length < 3) return setErro('Descreva o motivo (ex.: "Atestado médico", "Natal").')
    if (!de || !ate || ate < de) return setErro('Confira o período: a data final não pode ser anterior à inicial.')
    const minutos = diaInteiro ? null : hhmmParaMinutos(horas)
    if (minutos !== null && (Number.isNaN(minutos) || minutos <= 0)) return setErro('Informe as horas abonadas no formato HH:MM.')
    setSalvando(true)
    try {
      const { criados } = await api.incluirAbono({
        empresaId: empresa.id,
        funcionarioId: todos ? null : funcionario.id,
        tipo,
        descricao: descricao.trim(),
        de,
        ate,
        minutos,
      })
      notificar(criados === 1 ? 'Abono lançado.' : `Abono lançado em ${criados} dias.`)
      aoFechar()
    } catch (e) {
      setErro(mensagemErro(e))
    } finally {
      setSalvando(false)
    }
  }

  return (
    <Modal
      titulo="Lançar abono"
      aoFechar={aoFechar}
      aoEnviar={salvar}
      rodape={
        <>
          <button type="button" className="botao fantasma" onClick={aoFechar} disabled={salvando}>
            Cancelar
          </button>
          <button type="submit" className="botao primario" disabled={salvando}>
            {salvando ? 'Salvando...' : 'Lançar abono'}
          </button>
        </>
      }
    >
      <Aviso tipo="info">Dias abonados não contam como falta no espelho. Use para feriados, atestados, férias e folgas.</Aviso>
      <div className="grade-2">
        <Campo rotulo="Tipo">
          <select
            value={tipo}
            onChange={(e) => {
              const novo = e.target.value as TipoAbono
              setTipo(novo)
              if (novo === 'feriado') setTodos(true)
            }}
          >
            {TIPOS.map((t) => (
              <option key={t} value={t}>
                {ROTULOS_ABONO[t]}
              </option>
            ))}
          </select>
        </Campo>
        <Campo rotulo="Motivo">
          <input
            value={descricao}
            onChange={(e) => setDescricao(e.target.value)}
            maxLength={300}
            placeholder={tipo === 'feriado' ? 'Ex.: Natal' : 'Ex.: Atestado médico'}
            autoFocus
          />
        </Campo>
        <Campo rotulo="De">
          <input type="date" value={de} onChange={(e) => setDe(e.target.value)} />
        </Campo>
        <Campo rotulo="Até" ajuda="Para férias, informe o período todo (até 62 dias).">
          <input type="date" value={ate} min={de} onChange={(e) => setAte(e.target.value)} />
        </Campo>
      </div>
      <fieldset className="grupo">
        <legend>Vale para</legend>
        <label className="caixa-marcar">
          <input type="radio" name="alcance" checked={!todos} onChange={() => setTodos(false)} />
          Somente {funcionario.nome}
        </label>
        <label className="caixa-marcar">
          <input type="radio" name="alcance" checked={todos} onChange={() => setTodos(true)} />
          Todos os funcionários de {empresa.nome} (feriado, folga coletiva)
        </label>
      </fieldset>
      <label className="caixa-marcar">
        <input type="checkbox" checked={diaInteiro} onChange={(e) => setDiaInteiro(e.target.checked)} />
        Dia inteiro
      </label>
      {!diaInteiro && (
        <Campo rotulo="Horas abonadas em cada dia" ajuda="Ex.: 02:00 para uma consulta médica de duas horas.">
          <input value={horas} onChange={(e) => setHoras(e.target.value)} inputMode="numeric" maxLength={5} placeholder="02:00" />
        </Campo>
      )}
      {erro && <Aviso tipo="erro">{erro}</Aviso>}
    </Modal>
  )
}

export function DetalheAbono({ empresa, abono, aoFechar }: { empresa: Empresa; abono: Abono; aoFechar: () => void }) {
  const notificar = useNotificar()
  const [removendo, setRemovendo] = useState(false)
  const [erro, setErro] = useState('')

  async function remover() {
    setErro('')
    setRemovendo(true)
    try {
      await api.removerAbono({ empresaId: empresa.id, abonoId: abono.id })
      notificar('Abono removido.')
      aoFechar()
    } catch (e) {
      setErro(mensagemErro(e))
    } finally {
      setRemovendo(false)
    }
  }

  return (
    <Modal
      titulo={`${ROTULOS_ABONO[abono.tipo]} em ${formatarData(abono.data)}`}
      aoFechar={aoFechar}
      largura="pequena"
      rodape={
        <>
          <button type="button" className="botao fantasma" onClick={aoFechar} disabled={removendo}>
            Fechar
          </button>
          <button type="button" className="botao perigo-suave" onClick={remover} disabled={removendo}>
            <Trash2 size={16} aria-hidden /> {removendo ? 'Removendo...' : 'Remover abono'}
          </button>
        </>
      }
    >
      <dl className="lista-dados">
        <dt>Motivo</dt>
        <dd>{abono.descricao}</dd>
        <dt>Vale para</dt>
        <dd>{abono.funcionarioNome ?? 'Todos os funcionários'}</dd>
        <dt>Duração</dt>
        <dd>{abono.minutos === null ? 'Dia inteiro' : `${minutosParaHHMM(abono.minutos)} abonadas`}</dd>
        <dt>Lançado por</dt>
        <dd>
          {abono.criadoPor?.nome ?? '—'}
          {abono.criadoEm && ` em ${formatarDataHora(abono.criadoEm.toDate(), empresa.fusoHorario)}`}
        </dd>
      </dl>
      {abono.funcionarioId === null && <Aviso tipo="alerta">Abono coletivo: removê-lo afeta todos os funcionários da empresa.</Aviso>}
      {erro && <Aviso tipo="erro">{erro}</Aviso>}
    </Modal>
  )
}

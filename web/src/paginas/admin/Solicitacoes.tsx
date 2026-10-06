import { collection, limit, orderBy, query, where } from 'firebase/firestore'
import { Check, Inbox, Plus, X } from 'lucide-react'
import { useState } from 'react'
import { api } from '../../api'
import { Aviso, CabecalhoPagina, Campo, Carregando, Selo, Vazio } from '../../componentes/Basicos'
import Modal from '../../componentes/Modal'
import { useNotificar } from '../../componentes/Notificacoes'
import { useEmpresaAtual } from '../../contexto/Empresa'
import { db } from '../../firebase'
import { useColecao } from '../../hooks/useColecao'
import { classificar, rotuloTipo } from '../../lib/espelho'
import { mensagemErro } from '../../lib/erros'
import { dataLocal, formatarData, formatarDataHora, hhmmParaMinutos, nomeDiaCurto, somarDias } from '../../lib/tempo'
import {
  ordenarPorNome,
  paraFuncionario,
  paraRegistro,
  paraSolicitacao,
  type Empresa,
  type Funcionario,
  type Registro,
  type Solicitacao,
} from '../../tipos'

const HISTORICO_POR_PAGINA = 150

function Origem({ s, empresa }: { s: Solicitacao; empresa: Empresa }) {
  return (
    <>
      {s.origem === 'funcionario' ? `Pelo funcionário, no aparelho "${s.dispositivoNome ?? ''}"` : `Registrada por ${s.solicitadoPor.nome}`}
      {s.criadoEm && <small className="bloco">{formatarDataHora(s.criadoEm.toDate(), empresa.fusoHorario)}</small>}
    </>
  )
}

export default function Solicitacoes() {
  const empresa = useEmpresaAtual()
  const notificar = useNotificar()
  const [aba, setAba] = useState<'pendentes' | 'historico'>('pendentes')
  const [nova, setNova] = useState(false)
  const [recusando, setRecusando] = useState<Solicitacao | null>(null)
  const [ocupado, setOcupado] = useState<string | null>(null)
  const [erro, setErro] = useState('')
  const colecao = () => collection(db, 'empresas', empresa.id, 'solicitacoes')

  const pendentes = useColecao(() => query(colecao(), where('status', '==', 'pendente')), paraSolicitacao, `${empresa.id}:pendentes`)
  const [quantidadeHistorico, setQuantidadeHistorico] = useState(HISTORICO_POR_PAGINA)
  const historico = useColecao(
    () => (aba === 'historico' ? query(colecao(), orderBy('criadoEm', 'desc'), limit(quantidadeHistorico)) : null),
    paraSolicitacao,
    `${empresa.id}:historico:${aba}:${quantidadeHistorico}`,
  )
  const funcionarios = useColecao(() => collection(db, 'empresas', empresa.id, 'funcionarios'), paraFuncionario, `${empresa.id}:todos`)

  // Marcações já existentes nos dias pedidos, para o gestor decidir com contexto.
  const lista = [...pendentes.dados].sort((a, b) => `${a.data}${a.hora}`.localeCompare(`${b.data}${b.hora}`))
  const de = lista[0]?.data
  const ate = lista.reduce((maior, s) => (s.data > maior ? s.data : maior), de ?? '')
  const registros = useColecao(
    () =>
      de
        ? query(collection(db, 'empresas', empresa.id, 'registros'), where('dataLocal', '>=', de), where('dataLocal', '<=', ate))
        : null,
    paraRegistro,
    `${empresa.id}:contexto:${de}:${ate}`,
  )
  const doDia = (s: Solicitacao) =>
    classificar(
      registros.dados
        .filter((r) => r.funcionarioId === s.funcionarioId && r.dataLocal === s.data && !r.desconsiderado)
        .sort((a, b) => a.horaLocal.localeCompare(b.horaLocal)),
    )

  async function aprovar(s: Solicitacao) {
    setErro('')
    setOcupado(s.id)
    try {
      await api.decidirSolicitacao({ empresaId: empresa.id, solicitacaoId: s.id, aprovar: true })
      notificar(`Aprovada: marcação de ${s.funcionarioNome} às ${s.hora} incluída.`)
    } catch (e) {
      setErro(mensagemErro(e))
    } finally {
      setOcupado(null)
    }
  }

  return (
    <>
      <CabecalhoPagina
        titulo="Solicitações de ponto"
        descricao="Pedidos de inclusão de marcação esquecida. A marcação só passa a valer depois de aprovada."
        acoes={
          <button type="button" className="botao primario" onClick={() => setNova(true)}>
            <Plus size={16} aria-hidden /> Nova solicitação
          </button>
        }
      />

      <div className="alternador espaco-abaixo" role="tablist">
        <button type="button" className={aba === 'pendentes' ? 'ativo' : ''} onClick={() => setAba('pendentes')}>
          Pendentes{pendentes.dados.length > 0 && ` (${pendentes.dados.length})`}
        </button>
        <button type="button" className={aba === 'historico' ? 'ativo' : ''} onClick={() => setAba('historico')}>
          Histórico
        </button>
      </div>

      {erro && <Aviso tipo="erro">{erro}</Aviso>}
      {(pendentes.erro ?? historico.erro) && <Aviso tipo="erro">{pendentes.erro ?? historico.erro}</Aviso>}

      {aba === 'pendentes' ? (
        <section className="cartao sem-preenchimento">
          {pendentes.carregando ? (
            <Carregando />
          ) : lista.length === 0 ? (
            <Vazio icone={Inbox} titulo="Nenhuma solicitação pendente">
              Quando um funcionário esquecer de bater o ponto, ele pode pedir a inclusão no próprio aparelho, em "Esqueci de bater o
              ponto".
            </Vazio>
          ) : (
            <div className="tabela-rolagem">
              <table className="tabela">
                <thead>
                  <tr>
                    <th>Foto</th>
                    <th>Funcionário</th>
                    <th>Pede marcação em</th>
                    <th>Motivo</th>
                    <th>Marcações do dia</th>
                    <th>Pedido</th>
                    <th aria-label="Ações" />
                  </tr>
                </thead>
                <tbody>
                  {lista.map((s) => (
                    <tr key={s.id}>
                      <td>
                        {s.miniatura ? (
                          <span className="miniatura" style={{ width: 40, height: 40 }}>
                            <img src={s.miniatura} width={40} height={40} alt={`Foto de ${s.funcionarioNome} ao pedir`} />
                          </span>
                        ) : (
                          <span className="miniatura miniatura-inicial">{s.funcionarioNome.charAt(0)}</span>
                        )}
                      </td>
                      <td>
                        <strong>{s.funcionarioNome}</strong>
                        <small className="bloco">Matrícula {s.funcionarioMatricula}</small>
                      </td>
                      <td className="numeros sem-quebra">
                        <strong>{s.hora}</strong>
                        <small className="bloco">
                          {formatarData(s.data)} {nomeDiaCurto(s.data)}
                        </small>
                      </td>
                      <td>{s.motivo}</td>
                      <td>
                        <div className="chips">
                          {doDia(s).map((m: Registro & { tipo: 'entrada' | 'saida' }) => (
                            <span key={m.id} className={`chip chip-${m.tipo}`} title={rotuloTipo(m.tipo)}>
                              {m.horaLocal.slice(0, 5)}
                              {m.origem === 'manual' && '*'}
                            </span>
                          ))}
                          {doDia(s).length === 0 && <small className="texto-suave">nenhuma</small>}
                        </div>
                      </td>
                      <td>
                        <Origem s={s} empresa={empresa} />
                      </td>
                      <td className="sem-quebra">
                        <button
                          type="button"
                          className="botao pequeno primario"
                          disabled={ocupado !== null}
                          onClick={() => aprovar(s)}
                        >
                          <Check size={14} aria-hidden /> {ocupado === s.id ? 'Aprovando...' : 'Aprovar'}
                        </button>{' '}
                        <button
                          type="button"
                          className="botao pequeno perigo-suave"
                          disabled={ocupado !== null}
                          onClick={() => setRecusando(s)}
                        >
                          <X size={14} aria-hidden /> Recusar
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      ) : (
        <section className="cartao sem-preenchimento">
          {historico.carregando ? (
            <Carregando />
          ) : historico.dados.length === 0 ? (
            <Vazio icone={Inbox} titulo="Nenhuma solicitação ainda" />
          ) : (
            <div className="tabela-rolagem">
              <table className="tabela">
                <thead>
                  <tr>
                    <th>Situação</th>
                    <th>Funcionário</th>
                    <th>Marcação pedida</th>
                    <th>Motivo</th>
                    <th>Pedido</th>
                    <th>Decisão</th>
                  </tr>
                </thead>
                <tbody>
                  {historico.dados.map((s) => (
                    <tr key={s.id}>
                      <td>
                        {s.status === 'aprovada' && <Selo cor="verde">Aprovada</Selo>}
                        {s.status === 'recusada' && <Selo cor="vermelho">Recusada</Selo>}
                        {s.status === 'pendente' && <Selo cor="amarelo">Pendente</Selo>}
                      </td>
                      <td>
                        <strong>{s.funcionarioNome}</strong>
                        <small className="bloco">Matrícula {s.funcionarioMatricula}</small>
                      </td>
                      <td className="numeros sem-quebra">
                        {formatarData(s.data)} às {s.hora}
                      </td>
                      <td>{s.motivo}</td>
                      <td>
                        <Origem s={s} empresa={empresa} />
                      </td>
                      <td>
                        {s.decididoPor ? (
                          <>
                            {s.decididoPor.nome}
                            {s.decididoEm && <small className="bloco">{formatarDataHora(s.decididoEm.toDate(), empresa.fusoHorario)}</small>}
                            {s.motivoRecusa && <small className="bloco">Motivo: {s.motivoRecusa}</small>}
                          </>
                        ) : (
                          '—'
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}
      {aba === 'historico' && historico.dados.length >= quantidadeHistorico && (
        <div className="rodape-tabela carregar-mais">
          <span className="texto-suave">Mostrando as {historico.dados.length} solicitações mais recentes.</span>
          <button type="button" className="botao pequeno" onClick={() => setQuantidadeHistorico(quantidadeHistorico + HISTORICO_POR_PAGINA)}>
            Carregar mais antigas
          </button>
        </div>
      )}

      {nova && (
        <ModalNovaSolicitacao empresa={empresa} funcionarios={ordenarPorNome(funcionarios.dados)} aoFechar={() => setNova(false)} />
      )}
      {recusando && <ModalRecusa empresa={empresa} solicitacao={recusando} aoFechar={() => setRecusando(null)} />}
    </>
  )
}

function ModalRecusa({ empresa, solicitacao, aoFechar }: { empresa: Empresa; solicitacao: Solicitacao; aoFechar: () => void }) {
  const notificar = useNotificar()
  const [motivo, setMotivo] = useState('')
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState('')

  async function recusar() {
    setErro('')
    if (motivo.trim().length < 3) return setErro('Explique o motivo da recusa (fica registrado no histórico e na auditoria).')
    setSalvando(true)
    try {
      await api.decidirSolicitacao({ empresaId: empresa.id, solicitacaoId: solicitacao.id, aprovar: false, motivoRecusa: motivo.trim() })
      notificar('Solicitação recusada.')
      aoFechar()
    } catch (e) {
      setErro(mensagemErro(e))
    } finally {
      setSalvando(false)
    }
  }

  return (
    <Modal
      titulo="Recusar solicitação"
      largura="pequena"
      aoFechar={aoFechar}
      aoEnviar={recusar}
      rodape={
        <>
          <button type="button" className="botao fantasma" onClick={aoFechar} disabled={salvando}>
            Cancelar
          </button>
          <button type="submit" className="botao perigo" disabled={salvando}>
            {salvando ? 'Recusando...' : 'Recusar'}
          </button>
        </>
      }
    >
      <p>
        {solicitacao.funcionarioNome} pediu uma marcação em <strong>{formatarData(solicitacao.data)}</strong> às{' '}
        <strong>{solicitacao.hora}</strong>.
      </p>
      <Campo rotulo="Motivo da recusa">
        <textarea rows={3} value={motivo} onChange={(e) => setMotivo(e.target.value)} maxLength={300} autoFocus />
      </Campo>
      {erro && <Aviso tipo="erro">{erro}</Aviso>}
    </Modal>
  )
}

function ModalNovaSolicitacao({ empresa, funcionarios, aoFechar }: { empresa: Empresa; funcionarios: Funcionario[]; aoFechar: () => void }) {
  const notificar = useNotificar()
  const [hoje] = useState(() => dataLocal(new Date(), empresa.fusoHorario))
  const [funcionarioId, setFuncionarioId] = useState('')
  const [data, setData] = useState(hoje)
  const [hora, setHora] = useState('')
  const [motivo, setMotivo] = useState('')
  const [aprovarAgora, setAprovarAgora] = useState(true)
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState('')

  async function salvar() {
    setErro('')
    if (!funcionarioId) return setErro('Escolha o funcionário.')
    if (!data || data > hoje) return setErro('Informe um dia até hoje.')
    if (Number.isNaN(hhmmParaMinutos(hora))) return setErro('Informe o horário no formato HH:MM.')
    if (motivo.trim().length < 3) return setErro('Informe o motivo.')
    setSalvando(true)
    try {
      await api.criarSolicitacao({ empresaId: empresa.id, funcionarioId, data, hora, motivo: motivo.trim(), aprovarAgora })
      notificar(aprovarAgora ? 'Solicitação registrada e marcação incluída.' : 'Solicitação registrada como pendente.')
      aoFechar()
    } catch (e) {
      setErro(mensagemErro(e))
    } finally {
      setSalvando(false)
    }
  }

  return (
    <Modal
      titulo="Nova solicitação de marcação"
      aoFechar={aoFechar}
      aoEnviar={salvar}
      rodape={
        <>
          <button type="button" className="botao fantasma" onClick={aoFechar} disabled={salvando}>
            Cancelar
          </button>
          <button type="submit" className="botao primario" disabled={salvando}>
            {salvando ? 'Salvando...' : aprovarAgora ? 'Registrar e aprovar' : 'Registrar como pendente'}
          </button>
        </>
      }
    >
      <Aviso tipo="info">Use quando o funcionário avisar você que esqueceu de bater o ponto. Tudo fica registrado no histórico e na auditoria.</Aviso>
      <Campo rotulo="Funcionário">
        <select value={funcionarioId} onChange={(e) => setFuncionarioId(e.target.value)} autoFocus>
          <option value="">Selecione...</option>
          {funcionarios
            .filter((f) => f.ativo)
            .map((f) => (
              <option key={f.id} value={f.id}>
                {f.nome} (matrícula {f.matricula})
              </option>
            ))}
        </select>
      </Campo>
      <div className="grade-2">
        <Campo rotulo="Dia">
          <input type="date" value={data} min={somarDias(hoje, -31)} max={hoje} onChange={(e) => setData(e.target.value)} />
        </Campo>
        <Campo rotulo="Horário">
          <input type="time" value={hora} onChange={(e) => setHora(e.target.value)} />
        </Campo>
      </div>
      <Campo rotulo="Motivo">
        <input value={motivo} onChange={(e) => setMotivo(e.target.value)} maxLength={300} placeholder="Ex.: esqueceu de registrar a saída" />
      </Campo>
      <label className="caixa-marcar">
        <input type="checkbox" checked={aprovarAgora} onChange={(e) => setAprovarAgora(e.target.checked)} />
        Aprovar e incluir a marcação agora
      </label>
      {!aprovarAgora && <p className="texto-suave">A solicitação fica pendente até alguém com acesso à empresa aprovar.</p>}
      {erro && <Aviso tipo="erro">{erro}</Aviso>}
    </Modal>
  )
}

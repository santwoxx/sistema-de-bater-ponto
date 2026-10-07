import { collection, query, where } from 'firebase/firestore'
import { Clock, Tablet, UserCheck, Users } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Link } from 'react-router'
import AlertasSeguranca from '../../componentes/AlertasSeguranca'
import { Aviso, CabecalhoPagina, Carregando, Selo, Vazio } from '../../componentes/Basicos'
import { DetalhesRegistro, Miniatura } from '../../componentes/Marcacoes'
import { useEmpresaAtual } from '../../contexto/Empresa'
import { db } from '../../firebase'
import { useAgora, useColecao } from '../../hooks/useColecao'
import { classificar, rotuloTipo } from '../../lib/espelho'
import { dataLocal, dataPorExtenso, tempoRelativo } from '../../lib/tempo'
import { ordenarPorNome, paraAbono, paraDispositivo, paraFuncionario, paraRegistro, ROTULOS_ABONO, type Registro } from '../../tipos'

const ONLINE_MS = 20 * 60_000
const ORDEM_STATUS = { presente: 0, saiu: 1, abonado: 2, ausente: 3 }

export default function Hoje() {
  const empresa = useEmpresaAtual()
  const agora = useAgora(30_000)
  const hoje = dataLocal(new Date(agora), empresa.fusoHorario)
  const base = `empresas/${empresa.id}`
  const [detalhe, setDetalhe] = useState<Registro | null>(null)

  const funcionarios = useColecao(
    () => query(collection(db, base, 'funcionarios'), where('ativo', '==', true)),
    paraFuncionario,
    `${empresa.id}:ativos`,
  )
  const registros = useColecao(() => query(collection(db, base, 'registros'), where('dataLocal', '==', hoje)), paraRegistro, `${empresa.id}:${hoje}`)
  const aparelhos = useColecao(
    () => query(collection(db, base, 'dispositivos'), where('ativo', '==', true)),
    paraDispositivo,
    `${empresa.id}:aparelhos`,
  )
  const abonosHoje = useColecao(() => query(collection(db, base, 'abonos'), where('data', '==', hoje)), paraAbono, `${empresa.id}:abonos:${hoje}`)

  const validosPorFuncionario = useMemo(() => {
    const mapa = new Map<string, Registro[]>()
    for (const r of registros.dados) {
      if (r.desconsiderado) continue
      mapa.set(r.funcionarioId, [...(mapa.get(r.funcionarioId) ?? []), r])
    }
    for (const lista of mapa.values()) lista.sort((a, b) => a.dataHora.toMillis() - b.dataHora.toMillis())
    return mapa
  }, [registros.dados])

  const linhas = ordenarPorNome(funcionarios.dados)
    .map((funcionario) => {
      const marcacoes = classificar(validosPorFuncionario.get(funcionario.id) ?? [])
      const abono = abonosHoje.dados.find((a) => a.funcionarioId === null || a.funcionarioId === funcionario.id)
      const status: keyof typeof ORDEM_STATUS =
        marcacoes.length > 0 ? (marcacoes.length % 2 === 1 ? 'presente' : 'saiu') : abono ? 'abonado' : 'ausente'
      return { funcionario, marcacoes, status, abono }
    })
    .sort((a, b) => ORDEM_STATUS[a.status] - ORDEM_STATUS[b.status])

  const presentes = linhas.filter((l) => l.status === 'presente').length
  const online = aparelhos.dados.filter((a) => a.ultimoSinalEm && agora - a.ultimoSinalEm.toMillis() < ONLINE_MS).length
  const recentes = [...registros.dados].sort((a, b) => b.dataHora.toMillis() - a.dataHora.toMillis()).slice(0, 8)
  const erro = funcionarios.erro ?? registros.erro ?? aparelhos.erro

  return (
    <>
      <CabecalhoPagina titulo="Hoje" descricao={`${empresa.nome} · ${dataPorExtenso(new Date(agora), empresa.fusoHorario)}`} />
      {erro && <Aviso tipo="erro">{erro}</Aviso>}
      <AlertasSeguranca empresa={empresa} />

      <div className="indicadores">
        <div className="indicador">
          <UserCheck aria-hidden />
          <div>
            <strong>{presentes}</strong>
            <span>em expediente agora</span>
          </div>
        </div>
        <div className="indicador">
          <Users aria-hidden />
          <div>
            <strong>{funcionarios.dados.length}</strong>
            <span>funcionários ativos</span>
          </div>
        </div>
        <div className="indicador">
          <Clock aria-hidden />
          <div>
            <strong>{registros.dados.filter((r) => !r.desconsiderado).length}</strong>
            <span>marcações hoje</span>
          </div>
        </div>
        <div className="indicador">
          <Tablet aria-hidden />
          <div>
            <strong>
              {online}/{aparelhos.dados.length}
            </strong>
            <span>aparelhos online</span>
          </div>
        </div>
      </div>

      {aparelhos.dados.length === 0 && !aparelhos.carregando && (
        <Aviso tipo="alerta">
          Nenhum aparelho de ponto ativado para esta empresa. Veja como ativar em <Link to="/admin/aparelhos">Aparelhos de ponto</Link>.
        </Aviso>
      )}

      <div className="duas-colunas">
        <section className="cartao">
          <h2>Situação da equipe</h2>
          {funcionarios.carregando || registros.carregando ? (
            <Carregando />
          ) : linhas.length === 0 ? (
            <Vazio icone={Users} titulo="Nenhum funcionário ativo">
              Cadastre a equipe em <Link to="/admin/funcionarios">Funcionários</Link>.
            </Vazio>
          ) : (
            <ul className="lista-equipe">
              {linhas.map(({ funcionario, marcacoes, status, abono }) => (
                <li key={funcionario.id}>
                  {marcacoes.length > 0 ? (
                    <Miniatura registro={marcacoes[marcacoes.length - 1]} aoClicar={() => setDetalhe(marcacoes[marcacoes.length - 1])} />
                  ) : (
                    <span className="miniatura miniatura-inicial">{funcionario.nome.charAt(0)}</span>
                  )}
                  <div className="lista-equipe-nome">
                    <strong>{funcionario.nome}</strong>
                    <small>{funcionario.cargo || `Matrícula ${funcionario.matricula}`}</small>
                  </div>
                  <div className="lista-equipe-horas">
                    {marcacoes.map((m) => (
                      <button
                        type="button"
                        key={m.id}
                        className={`chip chip-${m.tipo}`}
                        title={`${rotuloTipo(m.tipo)}${m.origem === 'manual' ? ' (manual)' : ''}`}
                        onClick={() => setDetalhe(m)}
                      >
                        {m.horaLocal.slice(0, 5)}
                        {m.origem === 'manual' && '*'}
                      </button>
                    ))}
                  </div>
                  {status === 'presente' && <Selo cor="verde">Em expediente</Selo>}
                  {status === 'saiu' && <Selo cor="azul">Saiu</Selo>}
                  {status === 'abonado' && abono && <Selo cor="amarelo">{ROTULOS_ABONO[abono.tipo]}</Selo>}
                  {status === 'ausente' && <Selo>Sem marcação</Selo>}
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="cartao">
          <h2>Últimas marcações</h2>
          {recentes.length === 0 ? (
            <p className="texto-suave">Nenhuma marcação hoje.</p>
          ) : (
            <ul className="lista-recentes">
              {recentes.map((r) => (
                <li key={r.id} className={r.desconsiderado ? 'desconsiderada' : ''}>
                  <Miniatura registro={r} aoClicar={() => setDetalhe(r)} />
                  <div>
                    <strong>{r.funcionarioNome}</strong>
                    <small>
                      {r.horaLocal.slice(0, 5)} · {r.origem === 'manual' ? 'manual' : r.dispositivoNome} · {tempoRelativo(r.dataHora.toMillis(), agora)}
                    </small>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      {detalhe && <DetalhesRegistro registro={detalhe} empresa={empresa} aoFechar={() => setDetalhe(null)} />}
    </>
  )
}

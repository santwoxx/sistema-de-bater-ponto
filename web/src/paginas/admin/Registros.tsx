import { collection, limit, orderBy, query, where } from 'firebase/firestore'
import { ClipboardList, Download, Plus, Search } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Link } from 'react-router'
import { Aviso, CabecalhoPagina, Campo, Carregando, Selo, Vazio } from '../../componentes/Basicos'
import { DetalhesRegistro, Miniatura, ModalIncluirMarcacao } from '../../componentes/Marcacoes'
import { useEmpresaAtual } from '../../contexto/Empresa'
import { db } from '../../firebase'
import { useColecao } from '../../hooks/useColecao'
import { baixarCsv } from '../../lib/csv'
import { classificar, rotuloTipo } from '../../lib/espelho'
import { formatarNsr, normalizarBusca } from '../../lib/formatos'
import { dataLocal, diferencaDias, formatarData, nomeDiaCurto, somarDias } from '../../lib/tempo'
import { ordenarPorNome, paraFuncionario, paraRegistro, type Registro } from '../../tipos'

const MAX_DIAS = 92
// Teto de leitura por consulta: protege o custo e a velocidade em períodos longos.
const LIMITE_MARCACOES = 3000

export default function Registros() {
  const empresa = useEmpresaAtual()
  const [ate, setAte] = useState(() => dataLocal(new Date(), empresa.fusoHorario))
  const [de, setDe] = useState(() => somarDias(ate, -6))
  const [funcionarioId, setFuncionarioId] = useState('')
  const [busca, setBusca] = useState('')
  const [mostrarDesconsideradas, setMostrarDesconsideradas] = useState(true)
  const [incluindo, setIncluindo] = useState(false)
  const [detalhe, setDetalhe] = useState<Registro | null>(null)

  const periodoValido = Boolean(de && ate) && de <= ate && diferencaDias(de, ate) <= MAX_DIAS
  const funcionarios = useColecao(() => collection(db, 'empresas', empresa.id, 'funcionarios'), paraFuncionario, `${empresa.id}:todos`)
  const registros = useColecao(
    () => {
      if (!periodoValido) return null
      const colecao = collection(db, 'empresas', empresa.id, 'registros')
      const periodo = [
        where('dataLocal', '>=', de),
        where('dataLocal', '<=', ate),
        orderBy('dataLocal', 'desc'),
        limit(LIMITE_MARCACOES),
      ] as const
      return funcionarioId ? query(colecao, where('funcionarioId', '==', funcionarioId), ...periodo) : query(colecao, ...periodo)
    },
    paraRegistro,
    `${empresa.id}:${de}:${ate}:${funcionarioId}:${periodoValido}`,
  )

  // Entrada/saída é deduzida pela ordem das marcações válidas de cada pessoa no dia.
  const tipos = useMemo(() => {
    const grupos = new Map<string, Registro[]>()
    for (const r of registros.dados) {
      if (r.desconsiderado) continue
      const chave = `${r.funcionarioId}|${r.dataLocal}`
      grupos.set(chave, [...(grupos.get(chave) ?? []), r])
    }
    const resultado = new Map<string, 'entrada' | 'saida'>()
    for (const lista of grupos.values()) {
      lista.sort((a, b) => a.dataHora.toMillis() - b.dataHora.toMillis())
      for (const m of classificar(lista)) resultado.set(m.id, m.tipo)
    }
    return resultado
  }, [registros.dados])

  const termo = normalizarBusca(busca)
  const visiveis = registros.dados
    .filter((r) => mostrarDesconsideradas || !r.desconsiderado)
    .filter((r) => !termo || normalizarBusca(r.funcionarioNome).includes(termo) || r.funcionarioMatricula === busca.trim())
    .sort((a, b) => b.dataHora.toMillis() - a.dataHora.toMillis())

  function exportar() {
    const linhas = [...visiveis].reverse().map((r) => [
      formatarData(r.dataLocal),
      r.horaLocal,
      r.funcionarioNome,
      r.funcionarioMatricula,
      r.funcionarioCpf,
      tipos.has(r.id) ? rotuloTipo(tipos.get(r.id)!) : '',
      r.origem === 'manual'
        ? `Manual (${r.incluidoPor?.nome ?? ''})`
        : `${r.dispositivoNome ?? ''}${r.semInternet ? ` (sem internet${r.semInternet.conferir ? ', conferir horário' : ''})` : ''}`,
      r.nsr ?? '',
      r.justificativa ?? '',
      r.desconsiderado ? `Desconsiderada: ${r.desconsiderado.motivo}` : 'Válida',
      r.hash ?? '',
    ])
    baixarCsv(`marcacoes_${de}_a_${ate}.csv`, [
      ['Data', 'Hora', 'Funcionário', 'Matrícula', 'CPF', 'Tipo', 'Origem', 'NSR', 'Justificativa', 'Situação', 'Hash'],
      ...linhas,
    ])
  }

  const funcionariosOrdenados = ordenarPorNome(funcionarios.dados)

  return (
    <>
      <CabecalhoPagina
        titulo="Marcações"
        descricao="Todas as batidas de ponto, com foto, aparelho e situação."
        acoes={
          <>
            <button type="button" className="botao" onClick={exportar} disabled={visiveis.length === 0}>
              <Download size={16} aria-hidden /> Exportar CSV
            </button>
            <button type="button" className="botao primario" onClick={() => setIncluindo(true)}>
              <Plus size={16} aria-hidden /> Incluir marcação
            </button>
          </>
        }
      />

      <div className="filtros cartao">
        <Campo rotulo="De">
          <input type="date" value={de} max={ate} onChange={(e) => setDe(e.target.value)} />
        </Campo>
        <Campo rotulo="Até">
          <input type="date" value={ate} min={de} onChange={(e) => setAte(e.target.value)} />
        </Campo>
        <Campo rotulo="Funcionário">
          <select value={funcionarioId} onChange={(e) => setFuncionarioId(e.target.value)}>
            <option value="">Todos</option>
            {funcionariosOrdenados.map((f) => (
              <option key={f.id} value={f.id}>
                {f.nome}
                {f.ativo ? '' : ' (inativo)'}
              </option>
            ))}
          </select>
        </Campo>
        <Campo rotulo="Buscar na lista">
          <div className="busca">
            <Search size={16} aria-hidden />
            <input placeholder="Nome ou matrícula" value={busca} onChange={(e) => setBusca(e.target.value)} />
          </div>
        </Campo>
        <label className="caixa-marcar">
          <input type="checkbox" checked={mostrarDesconsideradas} onChange={(e) => setMostrarDesconsideradas(e.target.checked)} />
          Mostrar desconsideradas
        </label>
      </div>

      {!periodoValido && <Aviso tipo="alerta">Escolha um período válido de até {MAX_DIAS} dias.</Aviso>}
      {registros.dados.length >= LIMITE_MARCACOES && (
        <Aviso tipo="alerta">
          Mostrando as {LIMITE_MARCACOES.toLocaleString('pt-BR')} marcações mais recentes do período. Diminua o período ou escolha um
          funcionário para ver todas. Para baixar períodos longos completos, use <Link to="/admin/exportar">Exportar dados</Link>.
        </Aviso>
      )}
      {registros.erro && <Aviso tipo="erro">{registros.erro}</Aviso>}

      <section className="cartao sem-preenchimento">
        {registros.carregando ? (
          <Carregando />
        ) : visiveis.length === 0 ? (
          <Vazio icone={ClipboardList} titulo="Nenhuma marcação no período" />
        ) : (
          <div className="tabela-rolagem">
            <table className="tabela clicavel">
              <thead>
                <tr>
                  <th>Foto</th>
                  <th>Funcionário</th>
                  <th>Data</th>
                  <th>Hora</th>
                  <th>Tipo</th>
                  <th>Origem</th>
                  <th>NSR</th>
                  <th>Situação</th>
                </tr>
              </thead>
              <tbody>
                {visiveis.map((r) => (
                  <tr key={r.id} className={r.desconsiderado ? 'desconsiderada' : ''} onClick={() => setDetalhe(r)}>
                    <td>
                      <Miniatura registro={r} tamanho={36} />
                    </td>
                    <td>
                      <strong>{r.funcionarioNome}</strong>
                      <small className="bloco">Matrícula {r.funcionarioMatricula}</small>
                    </td>
                    <td className="numeros">
                      {formatarData(r.dataLocal)} <small>{nomeDiaCurto(r.dataLocal)}</small>
                    </td>
                    <td className="numeros">{r.horaLocal}</td>
                    <td>{tipos.has(r.id) ? rotuloTipo(tipos.get(r.id)!) : '—'}</td>
                    <td>
                      {r.origem === 'manual' ? <Selo cor="amarelo">Manual</Selo> : r.dispositivoNome}
                      {r.semInternet && (
                        <>
                          {' '}
                          <Selo cor={r.semInternet.conferir ? 'vermelho' : 'azul'}>
                            {r.semInternet.conferir ? 'Sem internet: conferir horário' : 'Sem internet'}
                          </Selo>
                        </>
                      )}
                    </td>
                    <td className="numeros">{formatarNsr(r.nsr)}</td>
                    <td>{r.desconsiderado ? <Selo cor="vermelho">Desconsiderada</Selo> : <Selo cor="verde">Válida</Selo>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
      <p className="texto-suave rodape-tabela">
        {visiveis.length} marcação(ões). Clique em uma linha para ver a foto e os detalhes.
      </p>

      {incluindo && (
        <ModalIncluirMarcacao
          empresa={empresa}
          funcionarios={funcionariosOrdenados}
          funcionarioIdInicial={funcionarioId}
          aoFechar={() => setIncluindo(false)}
        />
      )}
      {detalhe && <DetalhesRegistro registro={detalhe} empresa={empresa} aoFechar={() => setDetalhe(null)} />}
    </>
  )
}

import { collection } from 'firebase/firestore'
import { Download, Printer, Search } from 'lucide-react'
import { useState } from 'react'
import { api, type ResultadoExportacao, type TipoExportacao } from '../../api'
import { Aviso, CabecalhoPagina, Campo } from '../../componentes/Basicos'
import FolhaEspelho from '../../componentes/FolhaEspelho'
import { useNotificar } from '../../componentes/Notificacoes'
import { useEmpresaAtual } from '../../contexto/Empresa'
import { db } from '../../firebase'
import { useColecao } from '../../hooks/useColecao'
import { baixarCsv } from '../../lib/csv'
import { mensagemErro } from '../../lib/erros'
import { normalizarBusca } from '../../lib/formatos'
import { dataLocal, diasDoMes, diferencaDias, somarMeses } from '../../lib/tempo'
import { ordenarPorNome, paraFuncionario } from '../../tipos'

const TIPOS: Array<{ valor: TipoExportacao; titulo: string; descricao: string; formato: string }> = [
  {
    valor: 'marcacoes',
    titulo: 'Marcações',
    descricao: 'Uma linha por batida: data, hora, entrada/saída, origem, aparelho, NSR, situação e justificativas.',
    formato: 'CSV (abre no Excel)',
  },
  {
    valor: 'espelho-diario',
    titulo: 'Espelho diário',
    descricao: 'Uma linha por funcionário e dia: marcações, previsto, trabalhado, saldo e ocorrências.',
    formato: 'CSV (abre no Excel)',
  },
  {
    valor: 'resumo',
    titulo: 'Resumo por funcionário',
    descricao: 'Totais do período para a folha: dias trabalhados, previsto, trabalhado, saldo, faltas e abonos.',
    formato: 'CSV (abre no Excel)',
  },
  {
    valor: 'espelhos',
    titulo: 'Espelhos para imprimir ou PDF',
    descricao: 'Um espelho por funcionário e mês, com campos de assinatura (ou a assinatura eletrônica, se já assinado).',
    formato: 'Impressão / PDF',
  },
]

const MAX_DIAS = 366

// Exportação dos dados de ponto da empresa selecionada, com filtros.
// O arquivo é montado no servidor, então períodos longos não pesam no navegador.
export default function Exportar() {
  const empresa = useEmpresaAtual()
  const notificar = useNotificar()
  const [hoje] = useState(() => dataLocal(new Date(), empresa.fusoHorario))
  const mesAtual = hoje.slice(0, 7)
  const ultimoDia = (mes: string) => diasDoMes(mes).at(-1)!

  const [tipo, setTipo] = useState<TipoExportacao>('marcacoes')
  const [de, setDe] = useState(() => `${somarMeses(mesAtual, -1)}-01`)
  const [ate, setAte] = useState(() => ultimoDia(somarMeses(mesAtual, -1)))
  const [todos, setTodos] = useState(true)
  const [selecionados, setSelecionados] = useState<string[]>([])
  const [busca, setBusca] = useState('')
  const [incluirDesconsideradas, setIncluirDesconsideradas] = useState(false)
  const [origem, setOrigem] = useState<'todas' | 'dispositivo' | 'manual'>('todas')
  const [gerando, setGerando] = useState(false)
  const [erro, setErro] = useState('')
  const [impressao, setImpressao] = useState<ResultadoExportacao | null>(null)

  const funcionarios = useColecao(() => collection(db, 'empresas', empresa.id, 'funcionarios'), paraFuncionario, `${empresa.id}:todos`)
  const termo = normalizarBusca(busca)
  const lista = ordenarPorNome(funcionarios.dados).filter(
    (f) => !termo || normalizarBusca(f.nome).includes(termo) || f.matricula === busca.trim(),
  )

  const atalhos = [
    { rotulo: 'Este mês', de: `${mesAtual}-01`, ate: hoje },
    { rotulo: 'Mês passado', de: `${somarMeses(mesAtual, -1)}-01`, ate: ultimoDia(somarMeses(mesAtual, -1)) },
    { rotulo: 'Últimos 3 meses', de: `${somarMeses(mesAtual, -2)}-01`, ate: hoje },
    { rotulo: 'Este ano', de: `${mesAtual.slice(0, 4)}-01-01`, ate: hoje },
  ]

  function alternar(id: string) {
    setSelecionados(selecionados.includes(id) ? selecionados.filter((x) => x !== id) : [...selecionados, id])
  }

  async function gerar() {
    setErro('')
    if (!de || !ate || de > ate) return setErro('Confira o período: a data final não pode ser anterior à inicial.')
    if (diferencaDias(de, ate) >= MAX_DIAS) return setErro(`O período pode ter no máximo ${MAX_DIAS} dias.`)
    if (!todos && selecionados.length === 0) return setErro('Escolha pelo menos um funcionário.')
    setGerando(true)
    try {
      const resultado = await api.exportarDados({
        empresaId: empresa.id,
        tipo,
        de,
        ate,
        funcionarioIds: todos ? null : selecionados,
        incluirDesconsideradas,
        origem,
      })
      if (resultado.espelhos) {
        if (resultado.espelhos.length === 0) setErro('Nenhum funcionário no período escolhido.')
        else setImpressao(resultado)
      } else if (resultado.linhas) {
        baixarCsv(resultado.nomeArquivo, resultado.linhas)
        notificar(`Arquivo gerado: ${resultado.quantidade} linha(s) de dados.`)
      }
    } catch (e) {
      setErro(mensagemErro(e))
    } finally {
      setGerando(false)
    }
  }

  if (impressao?.espelhos) {
    return (
      <div className="impressao-lote">
        <div className="barra-impressao nao-imprimir">
          <span>
            <strong>{impressao.espelhos.length} espelho(s)</strong> de {impressao.empresa.nome}, um por folha.
          </span>
          <div className="cabecalho-acoes">
            <button type="button" className="botao" onClick={() => setImpressao(null)}>
              Voltar
            </button>
            <button type="button" className="botao primario" onClick={() => window.print()}>
              <Printer size={16} aria-hidden /> Imprimir / Salvar PDF
            </button>
          </div>
        </div>
        {impressao.espelhos.map((e) => (
          <FolhaEspelho key={`${e.funcionario.id}_${e.mes}`} espelho={e} empresa={impressao.empresa} fuso={empresa.fusoHorario} />
        ))}
      </div>
    )
  }

  return (
    <>
      <CabecalhoPagina
        titulo="Exportar dados"
        descricao={`Baixe os dados de ponto de ${empresa.nome} com os filtros que precisar.`}
      />

      <section className="cartao">
        <h2>1. O que exportar</h2>
        <div className="opcoes-exportacao" role="radiogroup">
          {TIPOS.map((t) => (
            <label key={t.valor} className={`opcao-exportacao ${tipo === t.valor ? 'escolhida' : ''}`}>
              <input type="radio" name="tipo" checked={tipo === t.valor} onChange={() => setTipo(t.valor)} />
              <span>
                <strong>{t.titulo}</strong>
                <small>{t.descricao}</small>
                <em>{t.formato}</em>
              </span>
            </label>
          ))}
        </div>
      </section>

      <section className="cartao">
        <h2>2. Período</h2>
        <div className="modelos">
          {atalhos.map((a) => (
            <button
              type="button"
              key={a.rotulo}
              className="botao pequeno"
              onClick={() => {
                setDe(a.de)
                setAte(a.ate)
              }}
            >
              {a.rotulo}
            </button>
          ))}
        </div>
        <div className="grade-2">
          <Campo rotulo="De">
            <input type="date" value={de} max={ate} onChange={(e) => setDe(e.target.value)} />
          </Campo>
          <Campo rotulo="Até" ajuda={`Até ${MAX_DIAS} dias por arquivo.`}>
            <input type="date" value={ate} min={de} max={hoje} onChange={(e) => setAte(e.target.value)} />
          </Campo>
        </div>
        {tipo === 'espelhos' && <p className="texto-suave">Nos espelhos, cada mês do período sai inteiro, um por folha.</p>}
      </section>

      <section className="cartao">
        <h2>3. Funcionários</h2>
        <label className="caixa-marcar">
          <input type="radio" name="quem" checked={todos} onChange={() => setTodos(true)} />
          Todos (ativos e quem tiver marcação no período)
        </label>
        <label className="caixa-marcar">
          <input type="radio" name="quem" checked={!todos} onChange={() => setTodos(false)} />
          Escolher funcionários ({selecionados.length} escolhido(s))
        </label>
        {!todos && (
          <div className="escolha-funcionarios">
            <div className="busca">
              <Search size={16} aria-hidden />
              <input placeholder="Buscar por nome ou matrícula" value={busca} onChange={(e) => setBusca(e.target.value)} />
            </div>
            <div className="lista-marcar">
              {lista.map((f) => (
                <label key={f.id} className="caixa-marcar">
                  <input type="checkbox" checked={selecionados.includes(f.id)} onChange={() => alternar(f.id)} />
                  {f.nome} <small className="texto-suave">matrícula {f.matricula}{f.ativo ? '' : ' · inativo'}</small>
                </label>
              ))}
            </div>
          </div>
        )}
      </section>

      {tipo === 'marcacoes' && (
        <section className="cartao">
          <h2>4. Filtros das marcações</h2>
          <div className="grade-2">
            <Campo rotulo="Origem">
              <select value={origem} onChange={(e) => setOrigem(e.target.value as typeof origem)}>
                <option value="todas">Todas</option>
                <option value="dispositivo">Só as batidas no aparelho</option>
                <option value="manual">Só as incluídas manualmente</option>
              </select>
            </Campo>
            <label className="caixa-marcar alinhar-base">
              <input type="checkbox" checked={incluirDesconsideradas} onChange={(e) => setIncluirDesconsideradas(e.target.checked)} />
              Incluir marcações desconsideradas (com o motivo)
            </label>
          </div>
        </section>
      )}

      {erro && <Aviso tipo="erro">{erro}</Aviso>}
      <div className="acoes-exportacao">
        <p className="texto-suave">
          O arquivo traz CPF e horários dos funcionários: guarde-o em local seguro. Cada exportação fica registrada na auditoria.
        </p>
        <button type="button" className="botao primario grande-auto" onClick={gerar} disabled={gerando}>
          {tipo === 'espelhos' ? <Printer size={18} aria-hidden /> : <Download size={18} aria-hidden />}{' '}
          {gerando ? 'Gerando...' : tipo === 'espelhos' ? 'Gerar espelhos' : 'Gerar e baixar arquivo'}
        </button>
      </div>
    </>
  )
}

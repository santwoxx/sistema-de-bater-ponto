import { collection, query, where } from 'firebase/firestore'
import { Download, FileCheck, Lock, Printer, RotateCcw } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router'
import { api, type ResultadoFechamento } from '../../api'
import { Aviso, CabecalhoPagina, Campo, Carregando, Vazio } from '../../componentes/Basicos'
import { ModalReabrir, SeloEspelho } from '../../componentes/EspelhoFechado'
import { useNotificar } from '../../componentes/Notificacoes'
import { useEmpresaAtual } from '../../contexto/Empresa'
import { db } from '../../firebase'
import { useColecao } from '../../hooks/useColecao'
import { baixarCsv } from '../../lib/csv'
import { mensagemErro } from '../../lib/erros'
import { formatarCpf } from '../../lib/formatos'
import { dataLocal, formatarDataHora, minutosParaHHMM, nomeMes, somarMeses } from '../../lib/tempo'
import { ordenarPorNome, paraEspelhoFechado, paraFuncionario, type Funcionario } from '../../tipos'

const DESCRICAO_RESULTADO: Record<ResultadoFechamento, string> = {
  fechado: 'fechado',
  atualizado: 'atualizado',
  'sem-alteracoes': 'sem alterações',
  'exige-motivo': 'já fechado e com mudanças: reabra com motivo',
}

// Fechamento mensal: congela o espelho de cada funcionário (a versão oficial),
// que o gestor imprime para o funcionário assinar em papel. Também serve para
// consultar meses antigos.
export default function Fechamento() {
  const empresa = useEmpresaAtual()
  const notificar = useNotificar()
  const [mesAtual] = useState(() => dataLocal(new Date(), empresa.fusoHorario).slice(0, 7))
  const [mes, setMes] = useState(() => somarMeses(mesAtual, -1))
  const [fechando, setFechando] = useState(false)
  const [resultados, setResultados] = useState<Map<string, ResultadoFechamento>>(new Map())
  const [reabrir, setReabrir] = useState<Funcionario | null>(null)
  const [erro, setErro] = useState('')

  const funcionarios = useColecao(() => collection(db, 'empresas', empresa.id, 'funcionarios'), paraFuncionario, `${empresa.id}:todos`)
  const espelhos = useColecao(
    () => (/^\d{4}-\d{2}$/.test(mes) ? query(collection(db, 'empresas', empresa.id, 'espelhos'), where('mes', '==', mes)) : null),
    paraEspelhoFechado,
    `${empresa.id}:espelhos:${mes}`,
  )
  const porFuncionario = new Map(espelhos.dados.map((e) => [e.funcionarioId, e]))
  // Ativos, mais inativos que tenham espelho fechado neste mês.
  const linhas = ordenarPorNome(funcionarios.dados.filter((f) => f.ativo || porFuncionario.has(f.id)))
  const mesEncerrado = mes < mesAtual

  async function fecharTodos() {
    setErro('')
    setFechando(true)
    try {
      const { resultados: lista } = await api.fecharEspelhos({ empresaId: empresa.id, mes })
      setResultados(new Map(lista.map((r) => [r.funcionarioId, r.resultado])))
      const novos = lista.filter((r) => r.resultado === 'fechado' || r.resultado === 'atualizado').length
      const presos = lista.filter((r) => r.resultado === 'exige-motivo').length
      notificar(
        `${novos} espelho(s) fechado(s)${presos ? `; ${presos} já fechado(s) mudaram e precisam ser reabertos com motivo` : ''}.`,
        presos ? 'info' : 'sucesso',
      )
    } catch (e) {
      setErro(mensagemErro(e))
    } finally {
      setFechando(false)
    }
  }

  function exportar() {
    baixarCsv(`fechamento_${mes}.csv`, [
      [`Fechamento de ponto - ${empresa.nome} - ${nomeMes(mes)}`],
      ['Funcionário', 'Matrícula', 'CPF', 'Situação', 'Previsto', 'Trabalhado', 'Saldo', 'Faltas', 'Dias trabalhados', 'Fechado em', 'Versão'],
      ...linhas.map((f) => {
        const e = porFuncionario.get(f.id)
        const t = e?.documento.totais
        return [
          f.nome,
          f.matricula,
          formatarCpf(f.cpf),
          e ? 'fechado' : 'não fechado',
          t ? minutosParaHHMM(t.previstoMin) : '',
          t ? minutosParaHHMM(t.trabalhadoMin) : '',
          t ? minutosParaHHMM(t.saldoMin, true) : '',
          t?.faltas ?? '',
          t?.diasTrabalhados ?? '',
          e?.fechadoEm ? formatarDataHora(e.fechadoEm.toDate(), empresa.fusoHorario) : '',
          e?.versao ?? '',
        ]
      }),
    ])
  }

  return (
    <>
      <CabecalhoPagina
        titulo="Fechamento mensal"
        descricao="Feche o mês para congelar o espelho de cada funcionário (a versão oficial). Depois, imprima os espelhos para os funcionários assinarem."
        acoes={
          <>
            <button type="button" className="botao" onClick={exportar} disabled={espelhos.dados.length === 0}>
              <Download size={16} aria-hidden /> CSV do mês
            </button>
            <Link className="botao" to="/admin/exportar">
              <Printer size={16} aria-hidden /> Imprimir espelhos
            </Link>
            <button type="button" className="botao primario" onClick={fecharTodos} disabled={!mesEncerrado || fechando}>
              <Lock size={16} aria-hidden /> {fechando ? 'Fechando...' : 'Fechar mês'}
            </button>
          </>
        }
      />

      <div className="filtros cartao">
        <Campo rotulo="Mês" ajuda="Escolha qualquer mês anterior para consultar ou fechar.">
          <input type="month" value={mes} max={mesAtual} onChange={(e) => setMes(e.target.value)} />
        </Campo>
      </div>

      {!mesEncerrado && <Aviso tipo="info">O mês atual só pode ser fechado depois que terminar. Escolha um mês anterior.</Aviso>}
      {erro && <Aviso tipo="erro">{erro}</Aviso>}
      {espelhos.erro && <Aviso tipo="erro">{espelhos.erro}</Aviso>}

      <div className="indicadores">
        <div className="indicador">
          <FileCheck aria-hidden />
          <div>
            <strong>
              {espelhos.dados.length}/{linhas.length}
            </strong>
            <span>fechados</span>
          </div>
        </div>
        <div className="indicador">
          <div>
            <strong>{linhas.length - espelhos.dados.length}</strong>
            <span>não fechados</span>
          </div>
        </div>
      </div>

      <section className="cartao sem-preenchimento">
        {funcionarios.carregando || espelhos.carregando ? (
          <Carregando />
        ) : linhas.length === 0 ? (
          <Vazio icone={FileCheck} titulo="Nenhum funcionário" />
        ) : (
          <div className="tabela-rolagem">
            <table className="tabela">
              <thead>
                <tr>
                  <th>Funcionário</th>
                  <th>Situação</th>
                  <th>Trabalhado</th>
                  <th>Saldo</th>
                  <th>Faltas</th>
                  <th>Fechado em</th>
                  <th aria-label="Ações" />
                </tr>
              </thead>
              <tbody>
                {linhas.map((f) => {
                  const e = porFuncionario.get(f.id)
                  const t = e?.documento.totais
                  const resultado = resultados.get(f.id)
                  return (
                    <tr key={f.id}>
                      <td>
                        <strong>{f.nome}</strong>
                        <small className="bloco">Matrícula {f.matricula}</small>
                      </td>
                      <td>
                        <SeloEspelho espelho={e} />
                        {e && e.versao > 1 && <small className="bloco">versão {e.versao}</small>}
                        {resultado === 'exige-motivo' && <small className="bloco pendente">Mudou depois do fechamento</small>}
                      </td>
                      <td className="numeros">{t ? minutosParaHHMM(t.trabalhadoMin) : '—'}</td>
                      <td className={`numeros ${t && t.saldoMin < 0 ? 'negativo' : t && t.saldoMin > 0 ? 'positivo' : ''}`}>
                        {t ? minutosParaHHMM(t.saldoMin, true) : '—'}
                      </td>
                      <td className="numeros">{t ? t.faltas : '—'}</td>
                      <td>
                        {e?.fechadoEm ? (
                          <>
                            {formatarDataHora(e.fechadoEm.toDate(), empresa.fusoHorario)}
                            <small className="bloco">por {e.fechadoPor.nome}</small>
                          </>
                        ) : (
                          '—'
                        )}
                      </td>
                      <td className="sem-quebra">
                        <Link className="botao pequeno" to={`/admin/espelho?funcionario=${f.id}&mes=${mes}`}>
                          Ver espelho
                        </Link>{' '}
                        {e && (
                          <button type="button" className="botao pequeno" onClick={() => setReabrir(f)}>
                            <RotateCcw size={14} aria-hidden /> Reabrir
                          </button>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
      {resultados.size > 0 && (
        <p className="texto-suave rodape-tabela">
          Último fechamento:{' '}
          {Object.entries(DESCRICAO_RESULTADO)
            .map(([chave, texto]) => [texto, [...resultados.values()].filter((r) => r === chave).length] as const)
            .filter(([, n]) => n > 0)
            .map(([texto, n]) => `${n} ${texto}`)
            .join(' · ')}
        </p>
      )}

      {reabrir && (
        <ModalReabrir empresa={empresa} mes={mes} funcionario={reabrir} aoFechar={() => setReabrir(null)} />
      )}
    </>
  )
}

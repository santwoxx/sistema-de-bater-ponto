import { collection, query, where } from 'firebase/firestore'
import { CalendarCheck, CalendarDays, Download, Plus, Printer } from 'lucide-react'
import { useState } from 'react'
import { DetalheAbono, ModalAbono } from '../../componentes/Abonos'
import { Aviso, CabecalhoPagina, Campo, Carregando, Vazio } from '../../componentes/Basicos'
import { DetalhesRegistro, ModalIncluirMarcacao } from '../../componentes/Marcacoes'
import { useEmpresaAtual } from '../../contexto/Empresa'
import { usePerfil } from '../../contexto/Sessao'
import { db } from '../../firebase'
import { useAgora, useColecao } from '../../hooks/useColecao'
import { baixarCsv } from '../../lib/csv'
import { calcularEspelho, type AbonoBruto, type DiaEspelho } from '../../lib/espelho'
import { formatarCnpj, formatarCpf } from '../../lib/formatos'
import { dataLocal, formatarData, formatarDataHora, minutosParaHHMM, nomeDiaCurto, nomeMes } from '../../lib/tempo'
import { ordenarPorNome, paraAbono, paraFuncionario, paraRegistro, ROTULOS_ABONO, type Abono, type Registro, type TipoAbono } from '../../tipos'

function rotuloAbono(abono: AbonoBruto): string {
  const tipo = ROTULOS_ABONO[abono.tipo as TipoAbono] ?? 'Abono'
  return `${tipo}${abono.minutos === null ? '' : ` ${minutosParaHHMM(abono.minutos)}`}: ${abono.descricao}`
}

function ocorrencias(dia: DiaEspelho, comAbonos = true): string {
  const lista: string[] = comAbonos ? dia.abonos.map(rotuloAbono) : []
  if (dia.falta) lista.push('Falta')
  if (dia.incompleto) lista.push('Marcação ímpar')
  if (dia.temManual) lista.push('Ajuste manual')
  if (dia.situacao === 'hoje') lista.push('Em andamento')
  if (dia.situacao === 'antes-admissao') lista.push('Antes da admissão')
  if (dia.situacao === 'antes-inicio') lista.push('Antes do início do controle')
  return lista.join(' · ')
}

export default function Espelho() {
  const empresa = useEmpresaAtual()
  const perfil = usePerfil()
  // Recalcula a cada minuto: se a tela ficar aberta na virada do dia, o "hoje" acompanha.
  const agora = useAgora(60_000)
  const hoje = dataLocal(new Date(agora), empresa.fusoHorario)
  const [mes, setMes] = useState(hoje.slice(0, 7))
  const [funcionarioId, setFuncionarioId] = useState('')
  const [incluirNoDia, setIncluirNoDia] = useState<string | null>(null)
  const [abonarNoDia, setAbonarNoDia] = useState<string | null>(null)
  const [detalhe, setDetalhe] = useState<Registro | null>(null)
  const [abonoAberto, setAbonoAberto] = useState<Abono | null>(null)

  const funcionarios = useColecao(() => collection(db, 'empresas', empresa.id, 'funcionarios'), paraFuncionario, `${empresa.id}:todos`)
  const ordenados = ordenarPorNome(funcionarios.dados)
  const funcionario = ordenados.find((f) => f.id === funcionarioId) ?? ordenados.find((f) => f.ativo) ?? null

  const registros = useColecao(
    () =>
      funcionario && mes
        ? query(
            collection(db, 'empresas', empresa.id, 'registros'),
            where('funcionarioId', '==', funcionario.id),
            where('dataLocal', '>=', `${mes}-01`),
            where('dataLocal', '<=', `${mes}-31`),
          )
        : null,
    paraRegistro,
    `${empresa.id}:${funcionario?.id}:${mes}`,
  )
  const abonosDoMes = useColecao(
    () =>
      mes
        ? query(collection(db, 'empresas', empresa.id, 'abonos'), where('data', '>=', `${mes}-01`), where('data', '<=', `${mes}-31`))
        : null,
    paraAbono,
    `${empresa.id}:abonos:${mes}`,
  )
  // Abonos do funcionário mais os coletivos (feriados, folgas da empresa toda).
  const abonos = abonosDoMes.dados.filter((a) => a.funcionarioId === null || a.funcionarioId === funcionario?.id)

  const resumo =
    funcionario && /^\d{4}-\d{2}$/.test(mes)
      ? calcularEspelho({
          mes,
          registros: registros.dados,
          jornada: funcionario.jornada,
          hoje,
          admissao: funcionario.admissao,
          inicioControle: empresa.inicioControle,
          abonos,
          toleranciaMin: empresa.toleranciaMinutos,
        })
      : null
  const registrosPorId = new Map(registros.dados.map((r) => [r.id, r]))
  const abonosPorId = new Map(abonos.map((a) => [a.id, a]))

  function exportar() {
    if (!resumo || !funcionario) return
    const linhas = resumo.dias.map((d) => [
      formatarData(d.data),
      nomeDiaCurto(d.data),
      d.marcacoes.map((m) => `${m.hora}${m.manual ? '*' : ''}`).join(' '),
      minutosParaHHMM(d.previstoMin),
      minutosParaHHMM(d.trabalhadoMin),
      d.saldoMin === null ? '' : minutosParaHHMM(d.saldoMin, true),
      ocorrencias(d),
    ])
    baixarCsv(`espelho_${funcionario.matricula}_${mes}.csv`, [
      [`Espelho de ponto - ${funcionario.nome} - matrícula ${funcionario.matricula} - ${nomeMes(mes)}`],
      ['Data', 'Dia', 'Marcações', 'Previsto', 'Trabalhado', 'Saldo', 'Ocorrências'],
      ...linhas,
      [],
      ['Totais', '', '', minutosParaHHMM(resumo.totalPrevistoMin), minutosParaHHMM(resumo.totalTrabalhadoMin), minutosParaHHMM(resumo.saldoMin, true)],
    ])
  }

  return (
    <>
      <CabecalhoPagina
        titulo="Espelho de ponto"
        descricao="Resumo mensal por funcionário: marcações, horas trabalhadas e saldo."
        acoes={
          <>
            <button type="button" className="botao" onClick={() => setAbonarNoDia(hoje)} disabled={!resumo}>
              <CalendarCheck size={16} aria-hidden /> Lançar abono
            </button>
            <button type="button" className="botao" onClick={exportar} disabled={!resumo}>
              <Download size={16} aria-hidden /> CSV
            </button>
            <button type="button" className="botao primario" onClick={() => window.print()} disabled={!resumo}>
              <Printer size={16} aria-hidden /> Imprimir / PDF
            </button>
          </>
        }
      />

      <div className="filtros cartao nao-imprimir">
        <Campo rotulo="Funcionário">
          <select value={funcionario?.id ?? ''} onChange={(e) => setFuncionarioId(e.target.value)}>
            {ordenados.length === 0 && <option value="">Nenhum funcionário</option>}
            {ordenados.map((f) => (
              <option key={f.id} value={f.id}>
                {f.nome} (matrícula {f.matricula}){f.ativo ? '' : ' · inativo'}
              </option>
            ))}
          </select>
        </Campo>
        <Campo rotulo="Mês">
          <input type="month" value={mes} max={hoje.slice(0, 7)} onChange={(e) => setMes(e.target.value)} />
        </Campo>
      </div>

      {(registros.erro ?? abonosDoMes.erro) && <Aviso tipo="erro">{registros.erro ?? abonosDoMes.erro}</Aviso>}

      {funcionarios.carregando ? (
        <Carregando />
      ) : !funcionario || !resumo ? (
        <Vazio icone={CalendarDays} titulo="Escolha um funcionário e um mês" />
      ) : (
        <section className="cartao espelho">
          <div className="cabecalho-espelho">
            <div>
              <h2>{funcionario.nome}</h2>
              <p>
                CPF {formatarCpf(funcionario.cpf)} · Matrícula {funcionario.matricula}
                {funcionario.cargo && ` · ${funcionario.cargo}`}
                {funcionario.admissao && ` · Admissão ${formatarData(funcionario.admissao)}`}
              </p>
            </div>
            <div className="texto-direita">
              <strong>{empresa.nome}</strong>
              <p>{empresa.cnpj ? `CNPJ ${formatarCnpj(empresa.cnpj)}` : ''}</p>
              <p>Período: {nomeMes(mes)}</p>
            </div>
          </div>

          <div className="indicadores compacto">
            <div className="indicador">
              <div>
                <strong>{minutosParaHHMM(resumo.totalTrabalhadoMin)}</strong>
                <span>trabalhadas</span>
              </div>
            </div>
            <div className="indicador">
              <div>
                <strong>{minutosParaHHMM(resumo.totalPrevistoMin)}</strong>
                <span>previstas (dias fechados)</span>
              </div>
            </div>
            <div className="indicador">
              <div>
                <strong className={resumo.saldoMin < 0 ? 'negativo' : resumo.saldoMin > 0 ? 'positivo' : ''}>
                  {minutosParaHHMM(resumo.saldoMin, true)}
                </strong>
                <span>saldo do mês</span>
              </div>
            </div>
            <div className="indicador">
              <div>
                <strong>
                  {resumo.faltas} / {resumo.diasIncompletos}
                </strong>
                <span>faltas / dias com marcação ímpar</span>
              </div>
            </div>
          </div>

          {registros.carregando ? (
            <Carregando />
          ) : (
            <div className="tabela-rolagem">
              <table className="tabela tabela-espelho">
                <thead>
                  <tr>
                    <th>Dia</th>
                    <th>Marcações</th>
                    <th>Previsto</th>
                    <th>Trabalhado</th>
                    <th>Saldo</th>
                    <th>Ocorrências</th>
                    <th className="nao-imprimir" aria-label="Ações" />
                  </tr>
                </thead>
                <tbody>
                  {resumo.dias.map((d) => (
                    <tr key={d.data} className={`${d.diaSemana === 0 ? 'domingo' : ''} ${d.situacao === 'futuro' ? 'futuro' : ''}`}>
                      <td className="numeros">
                        {formatarData(d.data).slice(0, 5)} <small>{nomeDiaCurto(d.data)}</small>
                      </td>
                      <td>
                        <div className="chips">
                          {d.marcacoes.map((m) => (
                            <button
                              type="button"
                              key={m.id}
                              className={`chip chip-${m.tipo}`}
                              title={m.manual ? 'Incluída manualmente' : 'Registrada no aparelho'}
                              onClick={() => {
                                const registro = registrosPorId.get(m.id)
                                if (registro) setDetalhe(registro)
                              }}
                            >
                              {m.hora}
                              {m.manual && '*'}
                            </button>
                          ))}
                        </div>
                      </td>
                      <td className="numeros">{d.previstoMin ? minutosParaHHMM(d.previstoMin) : '—'}</td>
                      <td className="numeros">{d.trabalhadoMin ? minutosParaHHMM(d.trabalhadoMin) : '—'}</td>
                      <td className={`numeros ${(d.saldoMin ?? 0) < 0 ? 'negativo' : (d.saldoMin ?? 0) > 0 ? 'positivo' : ''}`}>
                        {d.saldoMin === null ? '' : minutosParaHHMM(d.saldoMin, true)}
                      </td>
                      <td>
                        {d.abonos.length > 0 && (
                          <div className="chips">
                            {d.abonos.map((a) => (
                              <button
                                type="button"
                                key={a.id}
                                className="chip chip-abono"
                                title="Ver ou remover o abono"
                                onClick={() => setAbonoAberto(abonosPorId.get(a.id) ?? null)}
                              >
                                {rotuloAbono(a)}
                              </button>
                            ))}
                          </div>
                        )}
                        <small>{ocorrencias(d, false)}</small>
                      </td>
                      <td className="nao-imprimir sem-quebra">
                        {d.situacao !== 'futuro' && (
                          <button
                            type="button"
                            className="botao-icone"
                            title="Incluir marcação neste dia"
                            aria-label={`Incluir marcação em ${formatarData(d.data)}`}
                            onClick={() => setIncluirNoDia(d.data)}
                          >
                            <Plus size={16} />
                          </button>
                        )}
                        <button
                          type="button"
                          className="botao-icone"
                          title="Abonar este dia (feriado, atestado, férias...)"
                          aria-label={`Abonar ${formatarData(d.data)}`}
                          onClick={() => setAbonarNoDia(d.data)}
                        >
                          <CalendarCheck size={16} />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <td colSpan={2}>Totais</td>
                    <td className="numeros">{minutosParaHHMM(resumo.totalPrevistoMin)}</td>
                    <td className="numeros">{minutosParaHHMM(resumo.totalTrabalhadoMin)}</td>
                    <td className="numeros">{minutosParaHHMM(resumo.saldoMin, true)}</td>
                    <td colSpan={2} />
                  </tr>
                </tfoot>
              </table>
            </div>
          )}

          <p className="texto-suave legenda">
            * marcação incluída manualmente pelo gestor. Tolerância diária de {empresa.toleranciaMinutos} min aplicada ao saldo. O saldo
            considera só dias já encerrados.
          </p>

          <div className="assinaturas so-impressao">
            <div>
              <span />
              {funcionario.nome}
            </div>
            <div>
              <span />
              {empresa.nome}
            </div>
          </div>
          <p className="so-impressao texto-suave">
            Emitido em {formatarDataHora(new Date(agora), empresa.fusoHorario)} por {perfil.nome}.
          </p>
        </section>
      )}

      {incluirNoDia && funcionario && (
        <ModalIncluirMarcacao
          empresa={empresa}
          funcionarios={ordenados}
          funcionarioIdInicial={funcionario.id}
          dataInicial={incluirNoDia}
          aoFechar={() => setIncluirNoDia(null)}
        />
      )}
      {abonarNoDia && funcionario && (
        <ModalAbono empresa={empresa} funcionario={funcionario} dataInicial={abonarNoDia} aoFechar={() => setAbonarNoDia(null)} />
      )}
      {abonoAberto && <DetalheAbono empresa={empresa} abono={abonoAberto} aoFechar={() => setAbonoAberto(null)} />}
      {detalhe && <DetalhesRegistro registro={detalhe} empresa={empresa} aoFechar={() => setDetalhe(null)} />}
    </>
  )
}

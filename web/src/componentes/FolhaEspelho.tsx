import type { EspelhoParaImpressao } from '../api'
import { formatarCnpj, formatarCpf } from '../lib/formatos'
import { formatarData, formatarDataHora, minutosParaHHMM, nomeDiaCurto, nomeMes } from '../lib/tempo'

// Um espelho por folha, para impressão em lote ou PDF (Exportar dados), com as
// linhas para o funcionário e a empresa assinarem. Mês fechado sai com a
// versão oficial (congelada no fechamento).
export default function FolhaEspelho({
  espelho,
  empresa,
  fuso,
}: {
  espelho: EspelhoParaImpressao
  empresa: { nome: string; cnpj: string }
  fuso: string
}) {
  const { documento, funcionario: f, fechamento } = espelho
  const totais = documento.totais
  const fechadoEm = fechamento?.fechadoEm ? formatarDataHora(new Date(fechamento.fechadoEm), fuso) : '—'

  return (
    <section className="folha-espelho">
      <header className="cabecalho-espelho">
        <div>
          <h2>Espelho de ponto · {nomeMes(espelho.mes)}</h2>
          <p>
            <strong>{f.nome}</strong> · CPF {formatarCpf(f.cpf)} · Matrícula {f.matricula}
            {f.cargo && ` · ${f.cargo}`}
            {f.admissao && ` · Admissão ${formatarData(f.admissao)}`}
          </p>
        </div>
        <div className="texto-direita">
          <strong>{empresa.nome}</strong>
          {empresa.cnpj && <p>CNPJ {formatarCnpj(empresa.cnpj)}</p>}
          <p>
            {fechamento
              ? `Mês fechado em ${fechadoEm}${fechamento.versao > 1 ? ` (versão ${fechamento.versao})` : ''}`
              : 'Mês não fechado (prévia)'}
          </p>
        </div>
      </header>

      <table className="tabela tabela-espelho">
        <thead>
          <tr>
            <th>Dia</th>
            <th>Marcações</th>
            <th>Previsto</th>
            <th>Trabalhado</th>
            <th>Saldo</th>
            <th>Ocorrências</th>
          </tr>
        </thead>
        <tbody>
          {documento.dias.map((d) => (
            <tr key={d.data}>
              <td className="numeros sem-quebra">
                {formatarData(d.data).slice(0, 5)} <small>{nomeDiaCurto(d.data)}</small>
              </td>
              <td className="numeros">{d.marcacoes.map((m) => `${m.hora}${m.manual ? '*' : ''}`).join('  ')}</td>
              <td className="numeros">{d.previstoMin ? minutosParaHHMM(d.previstoMin) : '—'}</td>
              <td className="numeros">{d.trabalhadoMin ? minutosParaHHMM(d.trabalhadoMin) : '—'}</td>
              <td className="numeros">{d.saldoMin === null ? '' : minutosParaHHMM(d.saldoMin, true)}</td>
              <td>
                <small>{d.ocorrencias.join(' · ')}</small>
              </td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <td colSpan={2}>Totais</td>
            <td className="numeros">{minutosParaHHMM(totais.previstoMin)}</td>
            <td className="numeros">{minutosParaHHMM(totais.trabalhadoMin)}</td>
            <td className="numeros">{minutosParaHHMM(totais.saldoMin, true)}</td>
            <td>
              Faltas: {totais.faltas} · Marcação ímpar: {totais.diasIncompletos}
            </td>
          </tr>
        </tfoot>
      </table>
      <p className="legenda texto-suave">
        * marcação incluída manualmente pelo gestor. Tolerância diária de {documento.toleranciaMin} min aplicada ao saldo.
      </p>

      <div className="assinaturas">
        <div>
          <span />
          {f.nome}
        </div>
        <div>
          <span />
          {empresa.nome}
        </div>
      </div>
    </section>
  )
}

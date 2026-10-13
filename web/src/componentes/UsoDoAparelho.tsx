import { ordenarPorNome, type Funcionario } from '../tipos'
import { Campo } from './Basicos'

// Uso do aparelho, na ativação e no painel: aparelho da loja (cada um digita o
// próprio PIN) ou celular pessoal de um funcionário (só ele bate ponto, com o
// PIN dele). O valor é o id do dono; '' = aparelho da loja.
export default function UsoDoAparelho({
  funcionarios,
  valor,
  aoMudar,
}: {
  funcionarios: Funcionario[]
  valor: string
  aoMudar: (funcionarioId: string) => void
}) {
  const ativos = ordenarPorNome(funcionarios.filter((f) => f.ativo))
  const pessoal = valor !== ''
  return (
    <>
      <fieldset className="grupo">
        <legend>Uso do aparelho</legend>
        <label className="caixa-marcar">
          <input type="radio" name="uso-aparelho" checked={!pessoal} onChange={() => aoMudar('')} />
          <span>
            <strong>Aparelho da loja</strong> · todos batem ponto nele, cada um com o seu PIN
          </span>
        </label>
        <label className="caixa-marcar">
          <input
            type="radio"
            name="uso-aparelho"
            checked={pessoal}
            disabled={ativos.length === 0}
            onChange={() => aoMudar(ativos[0]?.id ?? '')}
          />
          <span>
            <strong>Celular pessoal de um funcionário</strong> · só ele bate ponto nele, com o PIN dele
          </span>
        </label>
      </fieldset>
      {pessoal && (
        <Campo rotulo="Funcionário dono do celular">
          <select value={valor} onChange={(e) => aoMudar(e.target.value)}>
            {ativos.map((f) => (
              <option key={f.id} value={f.id}>
                {f.nome} · matrícula {f.matricula}
              </option>
            ))}
          </select>
        </Campo>
      )}
    </>
  )
}

/**
 * Outras empresas cujos funcionários também batem ponto no aparelho da loja (ex.:
 * empresas do mesmo grupo na mesma loja). O PIN diz quem é, e a marcação vai
 * para a empresa do funcionário. fixas: empresas atendidas que quem está
 * editando não gerencia (continuam como estão).
 */
export function EmpresasAtendidas({
  opcoes,
  marcadas,
  aoMudar,
  fixas = 0,
}: {
  opcoes: { id: string; nome: string }[]
  marcadas: string[]
  aoMudar: (ids: string[]) => void
  fixas?: number
}) {
  if (opcoes.length === 0 && fixas === 0) return null
  return (
    <fieldset className="grupo">
      <legend>Outras empresas neste aparelho</legend>
      <p className="texto-suave">
        Marque as empresas cujos funcionários também batem ponto aqui. O PIN diz quem é, e a marcação vai para a empresa do
        funcionário.
      </p>
      {opcoes.map((empresa) => (
        <label key={empresa.id} className="caixa-marcar">
          <input
            type="checkbox"
            checked={marcadas.includes(empresa.id)}
            onChange={(e) => aoMudar(e.target.checked ? [...marcadas, empresa.id] : marcadas.filter((id) => id !== empresa.id))}
          />
          <span>{empresa.nome}</span>
        </label>
      ))}
      {fixas > 0 && <small className="texto-suave">Atende também {fixas === 1 ? '1 empresa' : `${fixas} empresas`} que você não gerencia.</small>}
    </fieldset>
  )
}

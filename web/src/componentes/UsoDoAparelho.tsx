import { ordenarPorNome, type Funcionario } from '../tipos'
import { Campo } from './Basicos'

// Uso do aparelho, na ativação e no painel: aparelho da loja (cada um digita a
// sua matrícula) ou celular pessoal de um funcionário (só ele bate ponto e
// digita só o PIN). O valor é o id do dono; '' = aparelho da loja.
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
            <strong>Aparelho da loja</strong> · todos batem ponto nele, cada um com a sua matrícula e PIN
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
            <strong>Celular pessoal de um funcionário</strong> · só ele bate ponto nele, digitando só o PIN
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

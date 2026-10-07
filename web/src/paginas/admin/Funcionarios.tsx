import { collection } from 'firebase/firestore'
import { Pencil, Search, UserPlus, Users } from 'lucide-react'
import { useState } from 'react'
import { api } from '../../api'
import { Aviso, CabecalhoPagina, Campo, Carregando, Selo, Vazio } from '../../componentes/Basicos'
import Modal from '../../componentes/Modal'
import { useNotificar } from '../../componentes/Notificacoes'
import { useEmpresaAtual } from '../../contexto/Empresa'
import { db } from '../../firebase'
import { useColecao } from '../../hooks/useColecao'
import { mensagemErro } from '../../lib/erros'
import { cpfValido, formatarCpf, normalizarBusca, somenteDigitos } from '../../lib/formatos'
import { problemaNoPin } from '../../lib/pin'
import { hhmmParaMinutos, minutosParaHHMM, NOMES_DIAS_LONGOS } from '../../lib/tempo'
import { JORNADA_PADRAO, ordenarPorNome, paraFuncionario, type Empresa, type Funcionario } from '../../tipos'

const MODELOS_JORNADA = [
  { rotulo: '44h · seg a sex 8h + sáb 4h', jornada: [0, 480, 480, 480, 480, 480, 240] },
  { rotulo: '44h · seg a sex 8h48', jornada: [0, 528, 528, 528, 528, 528, 0] },
  { rotulo: '40h · seg a sex 8h', jornada: [0, 480, 480, 480, 480, 480, 0] },
  { rotulo: '36h · seg a sáb 6h', jornada: [0, 360, 360, 360, 360, 360, 360] },
  { rotulo: '30h · seg a sex 6h', jornada: [0, 360, 360, 360, 360, 360, 0] },
]

function totalSemanal(jornada: number[]): string {
  const total = jornada.reduce((s, m) => s + m, 0)
  return minutosParaHHMM(total).replace(/:00$/, 'h').replace(':', 'h')
}

export default function Funcionarios() {
  const empresa = useEmpresaAtual()
  const funcionarios = useColecao(() => collection(db, 'empresas', empresa.id, 'funcionarios'), paraFuncionario, `${empresa.id}:todos`)
  const [busca, setBusca] = useState('')
  const [filtro, setFiltro] = useState<'ativos' | 'inativos' | 'todos'>('ativos')
  const [editando, setEditando] = useState<Funcionario | 'novo' | null>(null)

  const termo = normalizarBusca(busca)
  const digitos = somenteDigitos(busca)
  const lista = ordenarPorNome(funcionarios.dados)
    .filter((f) => (filtro === 'todos' ? true : filtro === 'ativos' ? f.ativo : !f.ativo))
    .filter(
      (f) =>
        !termo ||
        normalizarBusca(f.nome).includes(termo) ||
        (digitos.length > 0 && (f.matricula === digitos.replace(/^0+(?=\d)/, '') || f.cpf.includes(digitos))),
    )

  return (
    <>
      <CabecalhoPagina
        titulo="Funcionários"
        descricao="Cada funcionário bate o ponto digitando a matrícula e o PIN no aparelho."
        acoes={
          <button type="button" className="botao primario" onClick={() => setEditando('novo')}>
            <UserPlus size={16} aria-hidden /> Novo funcionário
          </button>
        }
      />

      <div className="filtros cartao">
        <Campo rotulo="Buscar">
          <div className="busca">
            <Search size={16} aria-hidden />
            <input placeholder="Nome, matrícula ou CPF" value={busca} onChange={(e) => setBusca(e.target.value)} />
          </div>
        </Campo>
        <Campo rotulo="Situação">
          <select value={filtro} onChange={(e) => setFiltro(e.target.value as typeof filtro)}>
            <option value="ativos">Ativos</option>
            <option value="inativos">Inativos</option>
            <option value="todos">Todos</option>
          </select>
        </Campo>
      </div>

      {funcionarios.erro && <Aviso tipo="erro">{funcionarios.erro}</Aviso>}

      <section className="cartao sem-preenchimento">
        {funcionarios.carregando ? (
          <Carregando />
        ) : lista.length === 0 ? (
          <Vazio icone={Users} titulo={funcionarios.dados.length === 0 ? 'Nenhum funcionário cadastrado' : 'Nenhum resultado'}>
            {funcionarios.dados.length === 0 && 'Cadastre o primeiro funcionário para começar a usar o ponto.'}
          </Vazio>
        ) : (
          <div className="tabela-rolagem">
            <table className="tabela clicavel">
              <thead>
                <tr>
                  <th>Nome</th>
                  <th>Matrícula</th>
                  <th>CPF</th>
                  <th>Cargo</th>
                  <th>Jornada</th>
                  <th>Situação</th>
                  <th aria-label="Ações" />
                </tr>
              </thead>
              <tbody>
                {lista.map((f) => (
                  <tr key={f.id} onClick={() => setEditando(f)}>
                    <td>
                      <strong>{f.nome}</strong>
                    </td>
                    <td className="numeros">{f.matricula}</td>
                    <td className="numeros">{formatarCpf(f.cpf)}</td>
                    <td>{f.cargo || '—'}</td>
                    <td>{totalSemanal(f.jornada)}/sem</td>
                    <td>
                      {f.ativo ? <Selo cor="verde">Ativo</Selo> : <Selo>Inativo</Selo>}{' '}
                      {!f.pinDefinido ? (
                        <Selo cor="amarelo">Sem PIN</Selo>
                      ) : (
                        f.pinProvisorio && <Selo cor="amarelo">PIN provisório</Selo>
                      )}
                    </td>
                    <td>
                      <button type="button" className="botao-icone" aria-label={`Editar ${f.nome}`}>
                        <Pencil size={16} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {editando && (
        <FormFuncionario
          empresa={empresa}
          funcionario={editando === 'novo' ? null : editando}
          todos={funcionarios.dados}
          aoFechar={() => setEditando(null)}
        />
      )}
    </>
  )
}

function proximaMatricula(todos: Funcionario[]): string {
  const maior = todos.reduce((m, f) => Math.max(m, Number(f.matricula) || 0), 0)
  return String(maior + 1)
}

function FormFuncionario({
  empresa,
  funcionario,
  todos,
  aoFechar,
}: {
  empresa: Empresa
  funcionario: Funcionario | null
  todos: Funcionario[]
  aoFechar: () => void
}) {
  const notificar = useNotificar()
  const novo = funcionario === null
  const [nome, setNome] = useState(funcionario?.nome ?? '')
  const [cpf, setCpf] = useState(funcionario ? formatarCpf(funcionario.cpf) : '')
  const [matricula, setMatricula] = useState(funcionario?.matricula ?? proximaMatricula(todos))
  const [cargo, setCargo] = useState(funcionario?.cargo ?? '')
  const [admissao, setAdmissao] = useState(funcionario?.admissao ?? '')
  const [jornada, setJornada] = useState(() => (funcionario?.jornada ?? JORNADA_PADRAO).map((m) => minutosParaHHMM(m)))
  const [ativo, setAtivo] = useState(funcionario?.ativo ?? true)
  const [alterarPin, setAlterarPin] = useState(novo || !funcionario?.pinDefinido)
  const [pin, setPin] = useState('')
  const [confirmacaoPin, setConfirmacaoPin] = useState('')
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState('')

  async function salvar() {
    setErro('')
    const minutos = jornada.map(hhmmParaMinutos)
    if (nome.trim().length < 3) return setErro('Informe o nome completo.')
    if (!cpfValido(cpf)) return setErro('CPF inválido.')
    if (!/^\d{1,10}$/.test(matricula.trim())) return setErro('A matrícula deve ter apenas números (até 10 dígitos).')
    if (minutos.some((m) => Number.isNaN(m))) return setErro('Jornada: use o formato HH:MM em todos os dias (00:00 para folga).')
    if (alterarPin) {
      const problema = problemaNoPin(pin)
      if (problema) return setErro(problema)
      if (pin !== confirmacaoPin) return setErro('Os PINs digitados não conferem.')
    }

    setSalvando(true)
    try {
      await api.salvarFuncionario({
        empresaId: empresa.id,
        ...(funcionario ? { id: funcionario.id } : {}),
        nome: nome.trim(),
        cpf: somenteDigitos(cpf),
        matricula: matricula.trim(),
        cargo: cargo.trim(),
        admissao: admissao || null,
        jornada: minutos,
        ativo,
        ...(alterarPin ? { pin } : {}),
      })
      notificar(novo ? 'Funcionário cadastrado.' : 'Funcionário atualizado.')
      aoFechar()
    } catch (e) {
      setErro(mensagemErro(e))
    } finally {
      setSalvando(false)
    }
  }

  return (
    <Modal
      titulo={novo ? 'Novo funcionário' : `Editar: ${funcionario.nome}`}
      aoFechar={aoFechar}
      aoEnviar={salvar}
      largura="grande"
      rodape={
        <>
          <button type="button" className="botao fantasma" onClick={aoFechar} disabled={salvando}>
            Cancelar
          </button>
          <button type="submit" className="botao primario" disabled={salvando}>
            {salvando ? 'Salvando...' : 'Salvar'}
          </button>
        </>
      }
    >
      <div className="grade-2">
        <Campo rotulo="Nome completo">
          <input value={nome} onChange={(e) => setNome(e.target.value)} maxLength={120} autoFocus />
        </Campo>
        <Campo rotulo="CPF">
          <input value={cpf} onChange={(e) => setCpf(e.target.value)} inputMode="numeric" placeholder="000.000.000-00" maxLength={14} />
        </Campo>
        <Campo rotulo="Matrícula" ajuda="Número que o funcionário digita no ponto.">
          <input value={matricula} onChange={(e) => setMatricula(somenteDigitos(e.target.value))} inputMode="numeric" maxLength={10} />
        </Campo>
        <Campo rotulo="Cargo (opcional)">
          <input value={cargo} onChange={(e) => setCargo(e.target.value)} maxLength={80} />
        </Campo>
        <Campo rotulo="Data de admissão (opcional)" ajuda="Dias anteriores não contam como falta no espelho.">
          <input type="date" value={admissao} onChange={(e) => setAdmissao(e.target.value)} />
        </Campo>
        <label className="caixa-marcar alinhar-base">
          <input type="checkbox" checked={ativo} onChange={(e) => setAtivo(e.target.checked)} />
          Funcionário ativo (pode bater ponto)
        </label>
      </div>

      <fieldset className="grupo">
        <legend>Jornada prevista por dia</legend>
        <div className="modelos">
          {MODELOS_JORNADA.map((m) => (
            <button type="button" key={m.rotulo} className="botao pequeno" onClick={() => setJornada(m.jornada.map((x) => minutosParaHHMM(x)))}>
              {m.rotulo}
            </button>
          ))}
        </div>
        <div className="grade-jornada">
          {[1, 2, 3, 4, 5, 6, 0].map((dia) => (
            <Campo key={dia} rotulo={NOMES_DIAS_LONGOS[dia]}>
              <input
                value={jornada[dia]}
                inputMode="numeric"
                maxLength={5}
                placeholder="00:00"
                onChange={(e) => setJornada(jornada.map((v, i) => (i === dia ? e.target.value : v)))}
              />
            </Campo>
          ))}
        </div>
        <small className="campo-ajuda">Horas a trabalhar em cada dia, sem contar o intervalo. Use 00:00 para folga.</small>
      </fieldset>

      <fieldset className="grupo">
        <legend>PIN do ponto</legend>
        <p className="texto-suave">
          O PIN definido aqui é <strong>provisório</strong>: no primeiro uso, o aparelho pede que o funcionário crie o PIN
          pessoal dele. Assim ninguém da empresa conhece o PIN que bate o ponto e assina o espelho.
          {!novo &&
            funcionario?.pinDefinido &&
            (funcionario.pinProvisorio ? ' Este funcionário ainda não criou o PIN pessoal.' : ' Este funcionário já usa o PIN pessoal.')}
        </p>
        {!novo && funcionario?.pinDefinido && (
          <label className="caixa-marcar">
            <input type="checkbox" checked={alterarPin} onChange={(e) => setAlterarPin(e.target.checked)} />
            Redefinir o PIN (para quem esqueceu: ele volta a ser provisório e a matrícula é desbloqueada)
          </label>
        )}
        {alterarPin && (
          <div className="grade-2">
            <Campo rotulo="PIN provisório" ajuda="4 a 6 números. Evite sequências (1234) e repetições (1111).">
              <input
                type="password"
                inputMode="numeric"
                autoComplete="new-password"
                value={pin}
                onChange={(e) => setPin(somenteDigitos(e.target.value).slice(0, 6))}
              />
            </Campo>
            <Campo rotulo="Confirme o PIN provisório">
              <input
                type="password"
                inputMode="numeric"
                autoComplete="new-password"
                value={confirmacaoPin}
                onChange={(e) => setConfirmacaoPin(somenteDigitos(e.target.value).slice(0, 6))}
              />
            </Campo>
          </div>
        )}
      </fieldset>

      {erro && <Aviso tipo="erro">{erro}</Aviso>}
    </Modal>
  )
}

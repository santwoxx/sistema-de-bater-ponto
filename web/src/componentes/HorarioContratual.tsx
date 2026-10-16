import { duracaoDoDia, MODELOS_HORARIO } from '../lib/horario'
import { NOMES_DIAS_LONGOS } from '../lib/tempo'

/**
 * Horário da semana (contratual), no cadastro do funcionário e nas escalas: um
 * dia por linha (segunda a domingo), com a duração ao lado e os modelos
 * prontos. Sem aoMudar, só mostra (ex.: o horário vem da escala).
 */
export function GradeHorario({ horario, aoMudar }: { horario: string[]; aoMudar?: (horario: string[]) => void }) {
  return (
    <>
      {aoMudar && (
        <div className="modelos">
          {MODELOS_HORARIO.map((m) => (
            <button type="button" key={m.rotulo} className="botao pequeno" onClick={() => aoMudar(m.horario)}>
              {m.rotulo}
            </button>
          ))}
        </div>
      )}
      <div className="grade-horario">
        {[1, 2, 3, 4, 5, 6, 0].map((dia) => (
          <label key={dia} className="linha-horario">
            <span>{NOMES_DIAS_LONGOS[dia]}</span>
            <input
              value={horario[dia]}
              placeholder="folga"
              maxLength={60}
              readOnly={!aoMudar}
              onChange={(e) => aoMudar?.(horario.map((v, i) => (i === dia ? e.target.value : v)))}
            />
            <small>{duracaoDoDia(horario[dia])}</small>
          </label>
        ))}
      </div>
      {aoMudar && (
        <small className="campo-ajuda">
          Entradas e saídas de cada dia, como no contrato: 08:00-12:00 13:00-17:00 (um espaço entre os pares). Em branco é folga. A jornada
          prevista do dia é a soma dos pares; ela vai no espelho e no AEJ (Portaria 671).
        </small>
      )}
    </>
  )
}

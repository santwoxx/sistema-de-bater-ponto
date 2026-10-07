import { collection, limit, orderBy, query, Timestamp, where } from 'firebase/firestore'
import { ShieldAlert } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router'
import { db } from '../firebase'
import { useColecao } from '../hooks/useColecao'
import { formatarDataHora } from '../lib/tempo'
import { paraAuditoria, type Empresa } from '../tipos'

// Avisos de segurança da empresa no painel. Os eventos vêm da auditoria (que
// só o servidor grava) e do resultado da verificação de integridade.

const ACOES_DE_ALERTA = ['pin.bloqueado', 'aparelho.bloqueado', 'integridade.alerta']
const DIAS = 7

/** Faixa no topo de todas as páginas quando a verificação de integridade achou problema. */
export function FaixaIntegridade({ empresa }: { empresa: Empresa }) {
  const problemas = empresa.integridade?.problemas ?? 0
  if (problemas === 0) return null
  return (
    <div className="faixa-alerta" role="alert">
      <ShieldAlert size={18} aria-hidden />
      <span>
        A verificação de integridade encontrou {problemas} problema(s) nas marcações de {empresa.nome}: alguma marcação pode ter
        sido alterada ou apagada fora do sistema. <Link to="/admin/auditoria">Ver detalhes</Link>
      </span>
    </div>
  )
}

/** Bloqueios por PIN errado e alertas de integridade dos últimos dias (página Hoje). */
export default function AlertasSeguranca({ empresa }: { empresa: Empresa }) {
  const [desde] = useState(() => Timestamp.fromMillis(Date.now() - DIAS * 86_400_000))
  const alertas = useColecao(
    () =>
      query(
        collection(db, 'empresas', empresa.id, 'auditoria'),
        where('acao', 'in', ACOES_DE_ALERTA),
        where('em', '>=', desde),
        orderBy('em', 'desc'),
        limit(10),
      ),
    paraAuditoria,
    `alertas:${empresa.id}`,
  )
  if (alertas.dados.length === 0) return null

  return (
    <section className="cartao alertas-seguranca">
      <h2>
        <ShieldAlert size={18} aria-hidden /> Alertas de segurança (últimos {DIAS} dias)
      </h2>
      <ul>
        {alertas.dados.map((alerta) => (
          <li key={alerta.id}>
            {typeof alerta.detalhes.foto === 'string' && alerta.detalhes.foto.startsWith('data:image/jpeg;base64,') && (
              <img src={alerta.detalhes.foto} alt="Foto da tentativa" />
            )}
            <div>
              <small>{alerta.em ? formatarDataHora(alerta.em.toDate(), empresa.fusoHorario) : ''}</small>
              <p>{alerta.descricao}</p>
            </div>
          </li>
        ))}
      </ul>
      <Link to="/admin/auditoria">Ver tudo na Auditoria</Link>
    </section>
  )
}

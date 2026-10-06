import { collection, limit, orderBy, query } from 'firebase/firestore'
import { History } from 'lucide-react'
import { useState } from 'react'
import { Aviso, CabecalhoPagina, Carregando, Vazio } from '../../componentes/Basicos'
import { useEmpresaAtual } from '../../contexto/Empresa'
import { usePerfil } from '../../contexto/Sessao'
import { db } from '../../firebase'
import { useColecao } from '../../hooks/useColecao'
import { formatarDataHora } from '../../lib/tempo'
import { paraAuditoria } from '../../tipos'

export default function Auditoria() {
  const empresa = useEmpresaAtual()
  const perfil = usePerfil()
  const [escopo, setEscopo] = useState<'empresa' | 'sistema'>('empresa')

  const entradas = useColecao(
    () =>
      query(
        escopo === 'empresa' ? collection(db, 'empresas', empresa.id, 'auditoria') : collection(db, 'auditoria'),
        orderBy('em', 'desc'),
        limit(300),
      ),
    paraAuditoria,
    `${escopo}:${empresa.id}`,
  )

  return (
    <>
      <CabecalhoPagina
        titulo="Auditoria"
        descricao="Histórico de alterações: quem fez, o quê e quando. Nada aqui pode ser apagado pelo painel."
        acoes={
          perfil.papel === 'admin' && (
            <div className="alternador" role="tablist">
              <button type="button" className={escopo === 'empresa' ? 'ativo' : ''} onClick={() => setEscopo('empresa')}>
                {empresa.nome}
              </button>
              <button type="button" className={escopo === 'sistema' ? 'ativo' : ''} onClick={() => setEscopo('sistema')}>
                Sistema (empresas e usuários)
              </button>
            </div>
          )
        }
      />

      {entradas.erro && <Aviso tipo="erro">{entradas.erro}</Aviso>}

      <section className="cartao sem-preenchimento">
        {entradas.carregando ? (
          <Carregando />
        ) : entradas.dados.length === 0 ? (
          <Vazio icone={History} titulo="Nenhum evento registrado" />
        ) : (
          <div className="tabela-rolagem">
            <table className="tabela">
              <thead>
                <tr>
                  <th>Quando</th>
                  <th>Quem</th>
                  <th>O que aconteceu</th>
                </tr>
              </thead>
              <tbody>
                {entradas.dados.map((e) => (
                  <tr key={e.id}>
                    <td className="numeros sem-quebra">{e.em ? formatarDataHora(e.em.toDate(), empresa.fusoHorario) : '—'}</td>
                    <td>{e.autor.nome}</td>
                    <td>
                      {e.descricao}
                      {typeof e.detalhes.justificativa === 'string' && <small className="bloco">Justificativa: {e.detalhes.justificativa}</small>}
                      {typeof e.detalhes.motivo === 'string' && <small className="bloco">Motivo: {e.detalhes.motivo}</small>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
      <p className="texto-suave rodape-tabela">Mostrando os 300 eventos mais recentes.</p>
    </>
  )
}

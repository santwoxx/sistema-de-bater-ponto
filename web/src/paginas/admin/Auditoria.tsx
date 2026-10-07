import { collection, limit, orderBy, query } from 'firebase/firestore'
import { History, ShieldCheck } from 'lucide-react'
import { useState } from 'react'
import { api, type ResultadoIntegridade } from '../../api'
import { Aviso, CabecalhoPagina, Carregando, Vazio } from '../../componentes/Basicos'
import { useEmpresaAtual } from '../../contexto/Empresa'
import { usePerfil } from '../../contexto/Sessao'
import { db } from '../../firebase'
import { useColecao } from '../../hooks/useColecao'
import { mensagemErro } from '../../lib/erros'
import { formatarDataHora } from '../../lib/tempo'
import { paraAuditoria } from '../../tipos'

const POR_PAGINA = 300

// Confere, no servidor, a sequência de NSR e a cadeia de hashes das marcações
// feitas no aparelho: aponta marcação apagada, inserida ou alterada.
function Integridade({ empresaId }: { empresaId: string }) {
  const [resultado, setResultado] = useState<ResultadoIntegridade | null>(null)
  const [verificando, setVerificando] = useState(false)
  const [erro, setErro] = useState('')

  async function verificar() {
    setErro('')
    setVerificando(true)
    try {
      setResultado(await api.verificarIntegridade({ empresaId }))
    } catch (e) {
      setErro(mensagemErro(e))
    } finally {
      setVerificando(false)
    }
  }

  return (
    <section className="cartao">
      <div className="integridade">
        <div>
          <h2>Integridade das marcações</h2>
          <p className="texto-suave">
            Cada marcação do aparelho tem um número sequencial (NSR) e um código que encadeia com a anterior. A verificação refaz
            essa conta e mostra qualquer marcação apagada, inserida ou alterada depois do registro, mesmo direto no banco.
          </p>
        </div>
        <button type="button" className="botao" onClick={() => void verificar()} disabled={verificando}>
          <ShieldCheck size={18} aria-hidden /> {verificando ? 'Verificando...' : 'Verificar agora'}
        </button>
      </div>
      {erro && <Aviso tipo="erro">{erro}</Aviso>}
      {resultado &&
        (resultado.totalProblemas === 0 ? (
          <Aviso tipo="sucesso">
            Cadeia íntegra: {resultado.marcacoesAparelho} marcação(ões) do aparelho conferidas
            {resultado.ultimoNsr > 0 ? ` (NSR 1 a ${resultado.ultimoNsr})` : ''}. As {resultado.marcacoesManuais} marcação(ões)
            manuais ficam fora da cadeia: cada uma tem justificativa e registro nesta auditoria.
          </Aviso>
        ) : (
          <Aviso tipo="erro">
            <strong>
              {resultado.totalProblemas} problema(s) em {resultado.marcacoesAparelho} marcação(ões) do aparelho.
            </strong>
            <ul className="lista-problemas">
              {resultado.problemas.map((p, i) => (
                <li key={`${p.registroId ?? 'x'}-${i}`}>{p.descricao}</li>
              ))}
            </ul>
            {resultado.totalProblemas > resultado.problemas.length && (
              <small>Mostrando os primeiros {resultado.problemas.length}.</small>
            )}
          </Aviso>
        ))}
    </section>
  )
}

export default function Auditoria() {
  const empresa = useEmpresaAtual()
  const perfil = usePerfil()
  const [escopo, setEscopo] = useState<'empresa' | 'sistema'>('empresa')
  const [quantidade, setQuantidade] = useState(POR_PAGINA)

  const entradas = useColecao(
    () =>
      query(
        escopo === 'empresa' ? collection(db, 'empresas', empresa.id, 'auditoria') : collection(db, 'auditoria'),
        orderBy('em', 'desc'),
        limit(quantidade),
      ),
    paraAuditoria,
    `${escopo}:${empresa.id}:${quantidade}`,
  )
  const trocarEscopo = (novo: typeof escopo) => {
    setEscopo(novo)
    setQuantidade(POR_PAGINA)
  }

  return (
    <>
      <CabecalhoPagina
        titulo="Auditoria"
        descricao="Histórico de alterações: quem fez, o quê e quando. Nada aqui pode ser apagado pelo painel."
        acoes={
          perfil.papel === 'admin' && (
            <div className="alternador" role="tablist">
              <button type="button" className={escopo === 'empresa' ? 'ativo' : ''} onClick={() => trocarEscopo('empresa')}>
                {empresa.nome}
              </button>
              <button type="button" className={escopo === 'sistema' ? 'ativo' : ''} onClick={() => trocarEscopo('sistema')}>
                Sistema (empresas e usuários)
              </button>
            </div>
          )
        }
      />

      {escopo === 'empresa' && <Integridade key={empresa.id} empresaId={empresa.id} />}

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
                      {/* Bloqueio por tentativas erradas: mostra a foto de quem estava no aparelho. */}
                      {typeof e.detalhes.foto === 'string' && e.detalhes.foto.startsWith('data:image/jpeg;base64,') ? (
                        <div className="bloco-assinatura">
                          <img src={e.detalhes.foto} alt="Foto da tentativa" />
                          <p>{e.descricao}</p>
                        </div>
                      ) : (
                        e.descricao
                      )}
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
      <div className="rodape-tabela carregar-mais">
        <span className="texto-suave">Mostrando os {entradas.dados.length} eventos mais recentes.</span>
        {entradas.dados.length >= quantidade && (
          <button type="button" className="botao pequeno" onClick={() => setQuantidade(quantidade + POR_PAGINA)}>
            Carregar eventos mais antigos
          </button>
        )}
      </div>
    </>
  )
}

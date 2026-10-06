import { signOut } from 'firebase/auth'
import {
  Building2,
  CalendarDays,
  ClipboardList,
  Fingerprint,
  History,
  LayoutDashboard,
  LogOut,
  Menu,
  Tablet,
  UserCog,
  Users,
} from 'lucide-react'
import { Suspense, useState } from 'react'
import { Link, NavLink, Outlet, useLocation } from 'react-router'
import { Carregando, Vazio } from '../../componentes/Basicos'
import SeletorEmpresa from '../../componentes/SeletorEmpresa'
import { useEmpresas } from '../../contexto/Empresa'
import { usePerfil } from '../../contexto/Sessao'
import { auth, NOME_SISTEMA } from '../../firebase'

const ITENS = [
  { para: '/admin', rotulo: 'Hoje', icone: LayoutDashboard, fim: true },
  { para: '/admin/registros', rotulo: 'Marcações', icone: ClipboardList },
  { para: '/admin/espelho', rotulo: 'Espelho de ponto', icone: CalendarDays },
  { para: '/admin/funcionarios', rotulo: 'Funcionários', icone: Users },
  { para: '/admin/aparelhos', rotulo: 'Aparelhos de ponto', icone: Tablet },
  { para: '/admin/auditoria', rotulo: 'Auditoria', icone: History },
]

const ITENS_ADMIN = [
  { para: '/admin/empresas', rotulo: 'Empresas', icone: Building2 },
  { para: '/admin/usuarios', rotulo: 'Usuários', icone: UserCog },
]

export default function LayoutAdmin() {
  const perfil = usePerfil()
  const { empresas, carregando, empresa } = useEmpresas()
  const location = useLocation()
  const [menuAberto, setMenuAberto] = useState(false)

  const paginaGlobal = ITENS_ADMIN.some((item) => location.pathname.startsWith(item.para))
  let conteudo
  if (carregando && !paginaGlobal) {
    conteudo = <Carregando />
  } else if (!empresa && !paginaGlobal) {
    conteudo =
      perfil.papel === 'admin' ? (
        <Vazio icone={Building2} titulo="Nenhuma empresa cadastrada">
          Comece cadastrando a primeira empresa em <Link to="/admin/empresas">Empresas</Link>.
        </Vazio>
      ) : (
        <Vazio icone={Building2} titulo="Nenhuma empresa liberada">
          Seu usuário ainda não tem acesso a nenhuma empresa. Peça ao administrador para liberar.
        </Vazio>
      )
  } else {
    conteudo = (
      <Suspense fallback={<Carregando />}>
        {/* key: ao trocar de empresa, a página recomeça do zero (filtros, seleções). */}
        <Outlet key={empresa?.id ?? 'global'} />
      </Suspense>
    )
  }

  const link = (item: { para: string; rotulo: string; icone: typeof Users; fim?: boolean }) => (
    <NavLink
      key={item.para}
      to={item.para}
      end={item.fim}
      className={({ isActive }) => (isActive ? 'ativo' : '')}
      onClick={() => setMenuAberto(false)}
    >
      <item.icone size={18} aria-hidden />
      {item.rotulo}
    </NavLink>
  )

  return (
    <div className="admin">
      <aside className={`menu-lateral ${menuAberto ? 'aberto' : ''}`}>
        <div className="marca">
          <Fingerprint size={24} aria-hidden />
          <span>{NOME_SISTEMA}</span>
        </div>
        <nav>
          {ITENS.map(link)}
          {perfil.papel === 'admin' && (
            <>
              <div className="menu-secao">Administração</div>
              {ITENS_ADMIN.map(link)}
            </>
          )}
        </nav>
        <div className="menu-rodape">
          <div className="usuario-atual">
            <strong>{perfil.nome}</strong>
            <small>{perfil.papel === 'admin' ? 'Administrador' : 'Gestor'}</small>
          </div>
          <button type="button" className="botao-icone" onClick={() => signOut(auth)} title="Sair" aria-label="Sair">
            <LogOut size={18} />
          </button>
        </div>
      </aside>
      {menuAberto && <div className="menu-sombra" onClick={() => setMenuAberto(false)} />}

      <div className="admin-principal">
        <header className="barra-topo">
          <button type="button" className="botao-icone so-celular" onClick={() => setMenuAberto(true)} aria-label="Abrir menu">
            <Menu size={22} />
          </button>
          {empresas.length > 0 && <SeletorEmpresa />}
        </header>
        <main className="admin-conteudo">{conteudo}</main>
      </div>
    </div>
  )
}

import { lazy, Suspense, type ReactNode } from 'react'
import { BrowserRouter, Navigate, Route, Routes, useLocation } from 'react-router'
import { Aviso, Carregando } from './componentes/Basicos'
import { NotificacoesProvider } from './componentes/Notificacoes'
import { SessaoProvider, useSessao } from './contexto/Sessao'
import { configuracaoOk } from './firebase'

// Cada área é carregada sob demanda: o aparelho de ponto não baixa o painel (nem o
// banco, que só o painel lê) e vice-versa.
const Ponto = lazy(() => import('./paginas/ponto/Ponto'))
const Login = lazy(() => import('./paginas/Login'))
const Comprovantes = lazy(() => import('./paginas/Comprovantes'))
const ConfiguracaoInicial = lazy(() => import('./paginas/ConfiguracaoInicial'))
const AreaAdmin = lazy(() => import('./paginas/admin/AreaAdmin'))
const Hoje = lazy(() => import('./paginas/admin/Hoje'))
const Registros = lazy(() => import('./paginas/admin/Registros'))
const Solicitacoes = lazy(() => import('./paginas/admin/Solicitacoes'))
const Espelho = lazy(() => import('./paginas/admin/Espelho'))
const Fechamento = lazy(() => import('./paginas/admin/Fechamento'))
const Exportar = lazy(() => import('./paginas/admin/Exportar'))
const Funcionarios = lazy(() => import('./paginas/admin/Funcionarios'))
const Aparelhos = lazy(() => import('./paginas/admin/Aparelhos'))
const Auditoria = lazy(() => import('./paginas/admin/Auditoria'))
const Empresas = lazy(() => import('./paginas/admin/Empresas'))
const Usuarios = lazy(() => import('./paginas/admin/Usuarios'))
const Portaria671 = lazy(() => import('./paginas/admin/Portaria671'))

function Inicio() {
  const sessao = useSessao()
  if (sessao.tipo === 'carregando') return <Carregando tela />
  if (sessao.tipo === 'dispositivo') return <Navigate to="/ponto" replace />
  if (sessao.tipo === 'usuario') return <Navigate to="/admin" replace />
  return <Navigate to="/login" replace />
}

function ExigirUsuario({ children }: { children: ReactNode }) {
  const sessao = useSessao()
  const location = useLocation()
  if (sessao.tipo === 'carregando') return <Carregando tela />
  if (sessao.tipo === 'dispositivo') return <Navigate to="/ponto" replace />
  if (sessao.tipo !== 'usuario') return <Navigate to="/login" replace state={{ de: location.pathname }} />
  return children
}

function ExigirAdmin({ children }: { children: ReactNode }) {
  const sessao = useSessao()
  if (sessao.tipo === 'usuario' && sessao.perfil.papel !== 'admin') return <Navigate to="/admin" replace />
  return children
}

function ConfiguracaoAusente() {
  return (
    <div className="tela-acesso">
      <div className="cartao-acesso">
        <h1>Falta configurar o Firebase</h1>
        <Aviso tipo="alerta">
          Crie o arquivo <code>web/.env</code> a partir de <code>web/.env.example</code> com os dados do seu projeto Firebase e rode o
          build novamente. O passo a passo está no README.
        </Aviso>
      </div>
    </div>
  )
}

export default function App() {
  if (!configuracaoOk) return <ConfiguracaoAusente />

  return (
    <BrowserRouter>
      <SessaoProvider>
        <NotificacoesProvider>
          <Suspense fallback={<Carregando tela />}>
            <Routes>
              <Route path="/" element={<Inicio />} />
              <Route path="/login" element={<Login />} />
              <Route path="/configuracao-inicial" element={<ConfiguracaoInicial />} />
              <Route path="/ponto" element={<Ponto />} />
              <Route path="/comprovantes" element={<Comprovantes />} />
              <Route
                path="/admin"
                element={
                  <ExigirUsuario>
                    <AreaAdmin />
                  </ExigirUsuario>
                }
              >
                <Route index element={<Hoje />} />
                <Route path="registros" element={<Registros />} />
                <Route path="solicitacoes" element={<Solicitacoes />} />
                <Route path="espelho" element={<Espelho />} />
                <Route path="fechamento" element={<Fechamento />} />
                <Route path="exportar" element={<Exportar />} />
                <Route path="funcionarios" element={<Funcionarios />} />
                <Route path="aparelhos" element={<Aparelhos />} />
                <Route path="auditoria" element={<Auditoria />} />
                <Route
                  path="empresas"
                  element={
                    <ExigirAdmin>
                      <Empresas />
                    </ExigirAdmin>
                  }
                />
                <Route
                  path="usuarios"
                  element={
                    <ExigirAdmin>
                      <Usuarios />
                    </ExigirAdmin>
                  }
                />
                <Route
                  path="portaria-671"
                  element={
                    <ExigirAdmin>
                      <Portaria671 />
                    </ExigirAdmin>
                  }
                />
              </Route>
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </Suspense>
        </NotificacoesProvider>
      </SessaoProvider>
    </BrowserRouter>
  )
}

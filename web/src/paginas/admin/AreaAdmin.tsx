import { EmpresaProvider } from '../../contexto/Empresa'
import LayoutAdmin from './LayoutAdmin'

/** Área do painel: escolha da empresa (que lê o banco) e o layout, carregados juntos sob demanda. */
export default function AreaAdmin() {
  return (
    <EmpresaProvider>
      <LayoutAdmin />
    </EmpresaProvider>
  )
}

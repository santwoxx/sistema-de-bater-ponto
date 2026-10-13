import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import './estilos.css'
import { iniciarInstalacao } from './lib/instalacao'

// O aviso de "dá para instalar como app" pode chegar antes de a tela do ponto abrir.
iniciarInstalacao()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

// Service worker: guarda a tela em cache para o aparelho de ponto abrir
// mesmo se a internet cair (o registro em si continua exigindo conexão).
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => undefined)
  })
}

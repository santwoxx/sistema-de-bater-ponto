import { plataformaDe } from './camera'

// Instalar o sistema como app (PWA), com o ícone "Ponto" na tela inicial.
// Chrome e Internet Samsung avisam (evento "beforeinstallprompt") quando o site
// pode ser instalado; o aviso pode chegar antes de a tela do ponto abrir, então
// é guardado desde o início (main.tsx). Instalado ou não, é o mesmo site: cada
// publicação chega sozinha (ver hooks/useNovaVersao.ts).

/** Evento do navegador (fora dos tipos padrão do TypeScript). */
interface PedidoDeInstalacao extends Event {
  prompt(): Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

/** instalado: aberto pelo ícone; disponivel: o botão "Instalar app" funciona; pelo-menu: só pelo menu do navegador. */
export type SituacaoInstalacao = 'instalado' | 'disponivel' | 'pelo-menu'

let pedido: PedidoDeInstalacao | null = null
let instalado = false
const ouvintes = new Set<() => void>()
const avisar = () => ouvintes.forEach((ouvinte) => ouvinte())

/** Chamada uma vez, ao abrir o site. */
export function iniciarInstalacao() {
  // Aberto pelo ícone do app (sem a barra do navegador). Conferido ao abrir,
  // antes de a tela do ponto poder pedir tela cheia.
  instalado =
    window.matchMedia('(display-mode: standalone), (display-mode: fullscreen)').matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  window.addEventListener('beforeinstallprompt', (evento) => {
    // Sem a barrinha do navegador: a instalação fica no botão "Instalar app".
    evento.preventDefault()
    pedido = evento as PedidoDeInstalacao
    avisar()
  })
  window.addEventListener('appinstalled', () => {
    instalado = true
    pedido = null
    avisar()
  })
}

export function situacaoDaInstalacao(): SituacaoInstalacao {
  return instalado ? 'instalado' : pedido ? 'disponivel' : 'pelo-menu'
}

export function acompanharInstalacao(ouvinte: () => void): () => void {
  ouvintes.add(ouvinte)
  return () => {
    ouvintes.delete(ouvinte)
  }
}

/** Abre a janela de instalação do navegador. Cada aviso do navegador vale uma vez. */
export async function instalar(): Promise<void> {
  const atual = pedido
  if (!atual) return
  pedido = null
  avisar()
  await atual.prompt()
  // Aceito: chega o "appinstalled". Recusado: o navegador pode avisar de novo depois.
  await atual.userChoice
}

/** Onde fica a instalação no menu de cada navegador (quando o botão não aparece). */
export function comoInstalar(agente: string, pontosDeToque = 0): string {
  if (plataformaDe(agente, pontosDeToque) === 'ios') return 'no Safari, toque em Compartilhar e em "Adicionar à Tela de Início".'
  if (/SamsungBrowser/i.test(agente)) return 'no menu ≡ da Internet Samsung, toque em "Adicionar página a" e depois em "Tela inicial".'
  if (/Firefox/i.test(agente)) return 'no menu ⋮ do Firefox, toque em "Instalar" (ou "Adicionar à tela inicial").'
  if (/EdgA?\//i.test(agente)) return 'no menu … do Edge, escolha "Adicionar ao telefone" ou "Aplicativos" → "Instalar este site como aplicativo".'
  if (/android/i.test(agente)) return 'no menu ⋮ do Chrome, toque em "Instalar app" (ou "Adicionar à tela inicial" e depois "Instalar").'
  return 'no Chrome do computador, clique no ícone de instalar na barra de endereço (ou menu ⋮ → "Transmitir, salvar e compartilhar" → "Instalar página como app").'
}

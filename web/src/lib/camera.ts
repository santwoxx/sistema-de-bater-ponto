// Regras da câmera do aparelho de ponto que não dependem do navegador em si:
// em que aparelho estamos, quando tentar outra configuração e o que dizer em
// cada problema (com o passo a passo para resolver). Ver hooks/useCamera.ts.

export type Plataforma = 'android' | 'ios' | 'outro'

export function plataformaDe(agente: string, pontosDeToque = 0): Plataforma {
  if (/android/i.test(agente)) return 'android'
  // iPad recente se apresenta como Mac, mas tem tela de toque.
  if (/iphone|ipad|ipod/i.test(agente) || (/macintosh/i.test(agente) && pontosDeToque > 1)) return 'ios'
  return 'outro'
}

const APLICATIVOS: Array<[RegExp, string]> = [
  [/Instagram/i, 'Instagram'],
  [/FBAN|FBAV|FB_IAB|FBIOS/i, 'Facebook'],
  [/WhatsApp/i, 'WhatsApp'],
  [/TikTok|musical_ly|BytedanceWebview/i, 'TikTok'],
  [/\bLine\//i, 'Line'],
  [/Twitter/i, 'X (Twitter)'],
  [/Snapchat/i, 'Snapchat'],
  [/LinkedInApp/i, 'LinkedIn'],
  // Navegador embutido genérico do Android (WebView).
  [/; wv\)/i, 'outro aplicativo'],
]

/** Navegador embutido em outro aplicativo: em geral, não libera a câmera para sites. */
export function navegadorInterno(agente: string): string | null {
  return APLICATIVOS.find(([padrao]) => padrao.test(agente))?.[1] ?? null
}

/** Nome do erro do navegador (DOMException), ou "Error" se não houver. */
export function nomeDoErro(erro: unknown): string {
  const nome = (erro as { name?: unknown } | null)?.name
  return typeof nome === 'string' && nome ? nome : 'Error'
}

/**
 * Erros em que vale tentar de novo com uma configuração mais simples: há
 * celulares que não abrem a câmera frontal em HD ("não foi possível iniciar a
 * fonte de vídeo") e abrem em resolução menor, ou só sem escolher a câmera.
 * Permissão negada não muda com outra configuração.
 */
export function tentarOutraConfiguracao(nome: string): boolean {
  return ['NotReadableError', 'OverconstrainedError', 'AbortError', 'NotFoundError', 'TypeError', 'SemImagem', 'Error'].includes(nome)
}

/** Códigos próprios, além dos erros do navegador. */
export type CodigoCamera =
  | 'Inseguro'
  | 'SemSuporte'
  | 'Aguardando'
  | 'ReproducaoBloqueada'
  | 'SemImagem'
  | 'Desconectada'
  | 'NotAllowedError'
  | 'NotFoundError'
  | 'NotReadableError'
  | string

const LIBERAR: Record<Plataforma, string> = {
  android:
    'No Chrome: toque no ícone ao lado do endereço (cadeado ou ajustes) › Permissões › Câmera › Permitir. ' +
    'Se a câmera não aparecer ali, libere-a para o Chrome em Configurações do Android › Apps › Chrome › Permissões.',
  ios: 'No Safari: toque em "aA" na barra de endereço › Ajustes do Site › Câmera › Permitir e recarregue a página (ou em Ajustes do iPhone › Safari › Câmera).',
  outro: 'Toque no ícone ao lado do endereço, libere a câmera nas permissões do site e toque em Tentar novamente.',
}

/** O que mostrar na área da câmera para cada problema, com o caminho para resolver. */
export function mensagemDaCamera(codigo: CodigoCamera, plataforma: Plataforma, interno: string | null): string {
  switch (codigo) {
    case 'Inseguro':
      return 'A câmera só funciona no endereço que começa com https://. Abra o ponto pelo link seguro do sistema.'
    case 'SemSuporte':
      return interno
        ? `O navegador de dentro do ${interno} não libera a câmera. Copie o endereço e abra no ${plataforma === 'ios' ? 'Safari' : 'Chrome'}.`
        : 'Este navegador não permite usar a câmera. Atualize-o ou abra o ponto no Chrome (Android) ou no Safari (iPhone).'
    case 'Aguardando':
      return 'Toque em "Ligar a câmera" e, quando o navegador perguntar, toque em Permitir.'
    case 'ReproducaoBloqueada':
      return 'Toque em "Ligar a câmera" para mostrar a imagem (o aparelho pode estar em modo de economia de energia).'
    case 'NotAllowedError':
    case 'SecurityError':
      return `A câmera está bloqueada para este site. ${LIBERAR[plataforma]}`
    case 'NotFoundError':
      return 'Nenhuma câmera encontrada neste aparelho.'
    case 'NotReadableError':
    case 'AbortError':
      return 'A câmera não pôde ser iniciada: outro aplicativo pode estar usando a câmera (câmera, chamada de vídeo, lanterna). Feche-o e toque em Tentar novamente. Se continuar, reinicie o aparelho.'
    case 'SemImagem':
      return 'A câmera abriu, mas não está mostrando imagem. Toque em Tentar novamente; se continuar, reinicie o aparelho.'
    case 'Desconectada':
      return 'A câmera foi desligada pelo aparelho. Toque em Tentar novamente.'
    default:
      return 'Não foi possível ligar a câmera. Toque em Tentar novamente; se continuar, recarregue a página.'
  }
}

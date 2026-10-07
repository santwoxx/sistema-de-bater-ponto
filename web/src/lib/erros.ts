// Traduz erros do Firebase para mensagens claras em português.

const MENSAGENS: Record<string, string> = {
  'auth/invalid-credential': 'E-mail ou senha incorretos.',
  'auth/invalid-login-credentials': 'E-mail ou senha incorretos.',
  'auth/wrong-password': 'E-mail ou senha incorretos.',
  'auth/user-not-found': 'E-mail ou senha incorretos.',
  'auth/invalid-email': 'E-mail inválido.',
  'auth/user-disabled': 'Este usuário está desativado.',
  'auth/too-many-requests': 'Muitas tentativas. Aguarde alguns minutos e tente novamente.',
  'auth/network-request-failed': 'Sem conexão com a internet.',
  'auth/invalid-api-key': 'Configuração do Firebase inválida (verifique o arquivo .env).',
  'functions/unavailable': 'Servidor indisponível ou sem internet. Tente novamente.',
  'functions/deadline-exceeded': 'O servidor demorou para responder. Tente novamente.',
  'functions/internal': 'Erro interno no servidor. Tente novamente em instantes.',
  'functions/not-found': 'Função não encontrada no servidor. As Cloud Functions foram publicadas?',
  'permission-denied': 'Você não tem permissão para ver estes dados.',
  unavailable: 'Sem conexão com o servidor. Verificando novamente...',
}

export function codigoErro(erro: unknown): string {
  return (erro as { code?: string } | null)?.code ?? ''
}

export function mensagemErro(erro: unknown): string {
  const codigo = codigoErro(erro)
  // O SDK de Functions acrescenta o status HTTP ao fim da mensagem ("... [403]").
  const mensagem = ((erro as { message?: string } | null)?.message ?? '').replace(/\s*\[\d{3}\]$/, '')

  // Erros lançados pelas nossas funções já vêm com mensagem em português.
  if (codigo.startsWith('functions/') && !(codigo in MENSAGENS) && mensagem && mensagem !== codigo.slice(10)) {
    return mensagem
  }
  if (codigo === 'failed-precondition' && /index/i.test(mensagem)) {
    return 'O banco ainda está criando um índice para esta consulta. Aguarde alguns minutos.'
  }
  return MENSAGENS[codigo] ?? (mensagem || 'Ocorreu um erro inesperado.')
}

export function erroDeRede(erro: unknown): boolean {
  return ['functions/unavailable', 'functions/deadline-exceeded', 'functions/internal', 'auth/network-request-failed'].includes(
    codigoErro(erro),
  )
}

/** O servidor recusou porque o PIN usado é o provisório: o funcionário precisa criar o dele. */
export function pinProvisorio(erro: unknown): boolean {
  return (erro as { details?: { motivo?: string } } | null)?.details?.motivo === 'pin-provisorio'
}

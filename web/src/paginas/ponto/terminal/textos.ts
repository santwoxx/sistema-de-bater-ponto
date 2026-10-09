import type { Etapa, Modo } from './tipos'

// Textos da tela do aparelho para cada momento (funções puras, testadas em textos.test.ts).

export interface EstadoTexto {
  etapa: Etapa
  modo: Modo
  /** Salvando o PIN pessoal no servidor. */
  salvandoPin: boolean
  /** Problema com o PIN novo digitado (ex.: sequência). */
  erroPin: string
  /** Celular pessoal: nome do dono (a tela pede só o PIN dele). */
  nomeDono?: string | null
}

/** "ELIANA MOREIRA DOS SANTOS" → "Eliana". */
export function primeiroNome(nome: string): string {
  const primeiro = nome.trim().split(/\s+/)[0] ?? ''
  return primeiro.charAt(0).toUpperCase() + primeiro.slice(1).toLowerCase()
}

/**
 * Matrícula ou PIN recusados. O servidor dá a mesma resposta para os dois (para
 * ninguém descobrir quais matrículas existem); a tela mostra o que foi digitado
 * e lembra o que é a matrícula. No celular pessoal, a matrícula é a do dono.
 */
export function mensagemCredenciais(matricula: string, pessoal: boolean): string {
  if (pessoal) return 'PIN incorreto. Confira o seu PIN e tente de novo.'
  return `Matrícula ${matricula} ou PIN inválidos. A matrícula é o número que o gestor cadastrou para você (não é o CPF nem o telefone). Confira também o PIN.`
}

export function textoDeEspera({ modo, salvandoPin }: Pick<EstadoTexto, 'modo' | 'salvandoPin'>): string {
  if (salvandoPin) return 'Salvando seu PIN...'
  if (modo === 'solicitacao') return 'Enviando a solicitação...'
  if (modo === 'assinatura') return 'Buscando seus espelhos...'
  return 'Registrando...'
}

export function tituloDaTela(estado: EstadoTexto): string {
  const { etapa, modo, salvandoPin, nomeDono } = estado
  if (nomeDono && etapa === 'pin' && modo === 'ponto') return `Olá, ${primeiroNome(nomeDono)}! Digite seu PIN`
  if (etapa === 'novoPin') return modo === 'trocarPin' ? 'Digite o novo PIN' : 'Crie seu PIN pessoal'
  if (etapa === 'confirmarPin') return 'Digite o novo PIN de novo'
  if (etapa === 'pin') return modo === 'trocarPin' ? 'Digite seu PIN atual' : 'Digite seu PIN'
  if (etapa === 'enviando' && (salvandoPin || modo === 'assinatura')) return textoDeEspera(estado)
  if (modo === 'solicitacao') return 'Esqueceu de bater? Digite sua matrícula'
  if (modo === 'assinatura') return 'Assinar espelho: digite sua matrícula'
  if (modo === 'trocarPin') return 'Trocar PIN: digite sua matrícula'
  if (etapa === 'foto') return 'Olhe para a câmera'
  if (etapa === 'enviando') return 'Registrando...'
  return 'Digite sua matrícula'
}

export function instrucaoDaTela({ etapa, modo, salvandoPin, erroPin }: EstadoTexto): string {
  if (etapa === 'novoPin' || etapa === 'confirmarPin') {
    if (erroPin) return erroPin
    if (etapa === 'confirmarPin') return 'Confirme digitando o mesmo PIN.'
    return modo === 'trocarPin'
      ? '4 a 6 números, sem sequências (1234) nem repetições (1111).'
      : 'Primeiro acesso: o PIN que você recebeu é provisório. Escolha um de 4 a 6 números que só você saiba.'
  }
  if (etapa === 'pin') {
    if (modo === 'solicitacao') return 'Depois do PIN, informe o dia e o horário que ficou sem marcação.'
    if (modo === 'assinatura') return 'Depois do PIN, confira o espelho do mês e assine.'
    if (modo === 'trocarPin') return 'Depois, escolha o novo PIN.'
    return 'Ao confirmar, olhe para a câmera: a foto é tirada automaticamente.'
  }
  if (etapa === 'foto' || etapa === 'enviando') {
    return modo === 'ponto' && !salvandoPin ? 'Fique parado, olhando para a câmera.' : 'Aguarde um instante.'
  }
  return 'Matrícula, depois o PIN.'
}

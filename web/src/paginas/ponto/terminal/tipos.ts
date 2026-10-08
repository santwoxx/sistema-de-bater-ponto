// Estados da tela do aparelho de ponto.

export type Etapa =
  | 'matricula'
  | 'pin'
  // O funcionário cria o PIN pessoal (ou troca o PIN): digita o novo e confirma.
  | 'novoPin'
  | 'confirmarPin'
  | 'foto'
  | 'formulario'
  | 'enviando'
  | 'espelho'
  | 'sucesso'
  // Sem internet: a batida ficou guardada no aparelho (ver semInternet.ts).
  | 'guardado'
  | 'solicitado'
  | 'assinado'
  | 'informacao'
  | 'pinDefinido'
  | 'erro'

/**
 * O que o funcionário está fazendo:
 * - "ponto": bater o ponto (padrão);
 * - "solicitacao": esqueceu de bater e pede a inclusão do horário;
 * - "assinatura": confere e assina o espelho de um mês fechado;
 * - "trocarPin": troca o próprio PIN.
 */
export type Modo = 'ponto' | 'solicitacao' | 'assinatura' | 'trocarPin'

export interface Pedido {
  data: string
  hora: string
  motivo: string
  outroMotivo: string
}

/** Telas que mostram um resultado e voltam ao início sozinhas (ou com um toque). */
export const ETAPAS_DE_RESULTADO: readonly Etapa[] = ['sucesso', 'guardado', 'erro', 'solicitado', 'assinado', 'informacao', 'pinDefinido']

export const OUTRO_MOTIVO = 'Outro motivo'
export const MOTIVOS = ['Esqueci de registrar', 'O aparelho estava sem internet ou com problema', 'Estava em trabalho externo', OUTRO_MOTIVO]

export const PEDIDO_VAZIO: Pedido = { data: '', hora: '', motivo: MOTIVOS[0], outroMotivo: '' }

// Estados da tela do aparelho de ponto. O funcionário só bate o ponto:
// solicitações, ajustes e o fechamento do mês ficam com o gestor, no painel.

export type Etapa =
  | 'matricula'
  | 'pin'
  // Primeiro uso: o funcionário cria o PIN pessoal (digita o novo e confirma).
  | 'novoPin'
  | 'confirmarPin'
  | 'foto'
  | 'enviando'
  | 'sucesso'
  // Sem internet: a batida ficou guardada no aparelho (ver semInternet.ts).
  | 'guardado'
  | 'erro'

/** Telas que mostram um resultado e voltam ao início sozinhas (ou com um toque). */
export const ETAPAS_DE_RESULTADO: readonly Etapa[] = ['sucesso', 'guardado', 'erro']

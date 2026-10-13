// Estados da tela do aparelho de ponto. O funcionário só bate o ponto,
// digitando o PIN de 4 números. Solicitações, ajustes, PIN e o fechamento do
// mês ficam com o gestor.

export type Etapa =
  | 'pin'
  | 'foto'
  | 'enviando'
  | 'sucesso'
  // Sem internet: a batida ficou guardada no aparelho (ver semInternet.ts).
  | 'guardado'
  | 'erro'

/** Telas que mostram um resultado e voltam ao início sozinhas (ou com um toque). */
export const ETAPAS_DE_RESULTADO: readonly Etapa[] = ['sucesso', 'guardado', 'erro']

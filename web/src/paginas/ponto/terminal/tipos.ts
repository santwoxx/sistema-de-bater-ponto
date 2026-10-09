// Estados da tela do aparelho de ponto. O funcionário só bate o ponto: no
// aparelho da loja, digita o CPF e o PIN de 4 números; no celular pessoal, só
// o PIN. Solicitações, ajustes, PIN e o fechamento do mês ficam com o gestor.

export type Etapa =
  | 'cpf'
  | 'pin'
  | 'foto'
  | 'enviando'
  | 'sucesso'
  // Sem internet: a batida ficou guardada no aparelho (ver semInternet.ts).
  | 'guardado'
  | 'erro'

/** Telas que mostram um resultado e voltam ao início sozinhas (ou com um toque). */
export const ETAPAS_DE_RESULTADO: readonly Etapa[] = ['sucesso', 'guardado', 'erro']

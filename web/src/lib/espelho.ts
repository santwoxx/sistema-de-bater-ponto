// O cálculo do espelho é o mesmo do servidor: a fonte única fica no backend
// (functions/src/espelho.ts), para que o espelho que o funcionário assina e o
// que o painel mostra nunca divirjam.
export * from '../../../functions/src/espelho'

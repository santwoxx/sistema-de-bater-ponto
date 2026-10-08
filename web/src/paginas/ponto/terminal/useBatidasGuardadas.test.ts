import { describe, expect, it } from 'vitest'
import { avisoDoEnvio } from './useBatidasGuardadas'

describe('aviso depois de enviar as batidas guardadas', () => {
  it('conta as enviadas, no singular e no plural', () => {
    expect(avisoDoEnvio({ enviadas: 1, recusadas: [], restantes: 0 })?.texto).toBe('Internet de volta: a batida guardada foi enviada.')
    expect(avisoDoEnvio({ enviadas: 3, recusadas: [], restantes: 0 })?.texto).toBe('Internet de volta: as 3 batidas guardadas foram enviadas.')
    expect(avisoDoEnvio({ enviadas: 0, recusadas: [], restantes: 2 })).toBeNull()
  })

  it('recusadas viram alerta com a matrícula e o motivo', () => {
    const aviso = avisoDoEnvio({ enviadas: 2, recusadas: [{ matricula: '7', motivo: 'matrícula ou PIN inválidos.' }], restantes: 0 })
    expect(aviso).toEqual({
      tipo: 'alerta',
      texto: '1 batida feita sem internet foi recusada (matrícula 7: matrícula ou PIN inválidos). O gestor foi avisado no painel.',
    })
  })
})

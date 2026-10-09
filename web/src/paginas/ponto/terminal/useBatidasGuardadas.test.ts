import { describe, expect, it } from 'vitest'
import { avisoDoEnvio } from './useBatidasGuardadas'

describe('aviso depois de enviar as batidas guardadas', () => {
  it('conta as enviadas, no singular e no plural', () => {
    expect(avisoDoEnvio({ enviadas: 1, recusadas: [], restantes: 0 })?.texto).toBe('Internet de volta: a batida guardada foi enviada.')
    expect(avisoDoEnvio({ enviadas: 3, recusadas: [], restantes: 0 })?.texto).toBe('Internet de volta: as 3 batidas guardadas foram enviadas.')
    expect(avisoDoEnvio({ enviadas: 0, recusadas: [], restantes: 2 })).toBeNull()
  })

  it('recusadas viram alerta com o motivo (sem repetir o mesmo motivo)', () => {
    expect(avisoDoEnvio({ enviadas: 2, recusadas: ['PIN incorreto.'], restantes: 0 })).toEqual({
      tipo: 'alerta',
      texto: '1 batida feita sem internet foi recusada (PIN incorreto). O gestor foi avisado no painel.',
    })
    expect(avisoDoEnvio({ enviadas: 0, recusadas: ['PIN incorreto.', 'PIN incorreto.'], restantes: 0 })?.texto).toBe(
      '2 batidas feitas sem internet foram recusadas (PIN incorreto). O gestor foi avisado no painel.',
    )
  })
})

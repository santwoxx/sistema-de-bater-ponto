// Sons curtos gerados no próprio navegador (sem arquivos de áudio).

let contexto: AudioContext | null = null

function tocar(notas: Array<[frequencia: number, inicio: number, duracao: number]>) {
  try {
    contexto ??= new AudioContext()
    if (contexto.state === 'suspended') void contexto.resume()
    const t0 = contexto.currentTime
    for (const [frequencia, inicio, duracao] of notas) {
      const oscilador = contexto.createOscillator()
      const volume = contexto.createGain()
      oscilador.type = 'sine'
      oscilador.frequency.value = frequencia
      volume.gain.setValueAtTime(0.0001, t0 + inicio)
      volume.gain.exponentialRampToValueAtTime(0.3, t0 + inicio + 0.02)
      volume.gain.exponentialRampToValueAtTime(0.0001, t0 + inicio + duracao)
      oscilador.connect(volume).connect(contexto.destination)
      oscilador.start(t0 + inicio)
      oscilador.stop(t0 + inicio + duracao + 0.05)
    }
  } catch {
    // sem áudio disponível
  }
}

export function somSucesso() {
  tocar([
    [880, 0, 0.12],
    [1320, 0.12, 0.25],
  ])
  navigator.vibrate?.(80)
}

export function somErro() {
  tocar([
    [320, 0, 0.22],
    [220, 0.22, 0.32],
  ])
  navigator.vibrate?.([120, 80, 120])
}

export function somFoto() {
  tocar([[1600, 0, 0.06]])
}

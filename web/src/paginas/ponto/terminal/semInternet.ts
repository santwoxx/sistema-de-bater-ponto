import { codigoErro } from '../../../lib/erros'
import { gravarLocal, lerLocal } from '../../../lib/util'

// Batidas guardadas sem internet: ficam neste aparelho, cifradas com a chave
// pública do servidor (PIN e foto não ficam legíveis aqui: só o servidor abre),
// e vão sozinhas quando a internet volta. O horário é contado a partir da
// "âncora" assinada pelo servidor na última sincronização, com o relógio
// contínuo do navegador, que não muda se alguém mexer no relógio do aparelho.
// A conferência (PIN, horário, intervalo) é do servidor: functions/src/semInternet.ts.

export const CHAVE_REFERENCIA = 'ponto.semInternet'
const BANCO = 'ponto-sem-internet'
const FILA = 'batidas'
/** Cabem alguns dias sem internet, mas ninguém consegue testar PINs à vontade. */
export const MAX_GUARDADAS = 300
export const MAX_POR_MATRICULA = 12

export interface Ancora {
  em: number
  assinatura: string
}

export interface DadosSemInternet {
  chavePublica: string
  ancora: Ancora
}

/** Âncora da última sincronização e os relógios do aparelho naquele momento. */
interface Referencia extends DadosSemInternet {
  relogio: number
  monotonico: number
  /** Identifica a página: o relógio contínuo recomeça quando ela é reaberta. */
  origemDaPagina: number
}

export interface PacoteSelado {
  versao: 1
  chave: string
  iv: string
  dados: string
}

interface BatidaGuardada {
  id: string
  matricula: string
  horario: number
  pacote: PacoteSelado
}

export type ResultadoEnvio = { resultado: 'registrada'; conferir: boolean } | { resultado: 'duplicada' | 'recusada'; motivo: string }

export interface ResumoEnvio {
  enviadas: number
  recusadas: Array<{ matricula: string; motivo: string }>
  restantes: number
}

/** Guarda a âncora recebida na sincronização (no meio da ida e volta, para descontar a latência). */
export function guardarReferencia(dados: DadosSemInternet, relogio: number, monotonico: number) {
  const referencia: Referencia = { ...dados, relogio, monotonico, origemDaPagina: performance.timeOrigin }
  gravarLocal(CHAVE_REFERENCIA, JSON.stringify(referencia))
}

function lerReferencia(): Referencia | null {
  try {
    return JSON.parse(lerLocal(CHAVE_REFERENCIA) ?? 'null') as Referencia | null
  } catch {
    return null
  }
}

/** O aparelho já recebeu do servidor o necessário para guardar batidas. */
export function podeGuardar(): boolean {
  return lerReferencia() !== null && typeof indexedDB !== 'undefined' && Boolean(globalThis.crypto?.subtle)
}

// --- Cifragem (a mesma que o servidor abre) --------------------------------------
// Os dados vão cifrados com AES-256-GCM, e a chave AES vai cifrada com a chave
// pública RSA-OAEP (SHA-256) do servidor.

function paraBase64(dados: ArrayBuffer | Uint8Array): string {
  const bytes = dados instanceof Uint8Array ? dados : new Uint8Array(dados)
  let texto = ''
  for (let i = 0; i < bytes.length; i += 0x8000) texto += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(texto)
}

const deBase64 = (texto: string) => Uint8Array.from(atob(texto), (c) => c.charCodeAt(0))

export async function selar(chavePublica: string, conteudo: unknown): Promise<PacoteSelado> {
  const subtle = globalThis.crypto.subtle
  const publica = await subtle.importKey('spki', deBase64(chavePublica), { name: 'RSA-OAEP', hash: 'SHA-256' }, false, ['encrypt'])
  const aes = await subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt'])
  const iv = globalThis.crypto.getRandomValues(new Uint8Array(12))
  const dados = await subtle.encrypt({ name: 'AES-GCM', iv }, aes, new TextEncoder().encode(JSON.stringify(conteudo)))
  const chave = await subtle.encrypt({ name: 'RSA-OAEP' }, publica, await subtle.exportKey('raw', aes))
  return { versao: 1, chave: paraBase64(chave), iv: paraBase64(iv), dados: paraBase64(dados) }
}

// --- Fila no IndexedDB --------------------------------------------------------------

function abrirBanco(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const pedido = indexedDB.open(BANCO, 1)
    pedido.onupgradeneeded = () => pedido.result.createObjectStore(FILA, { keyPath: 'id' })
    pedido.onsuccess = () => resolve(pedido.result)
    pedido.onerror = () => reject(pedido.error)
  })
}

async function naFila<T>(modo: IDBTransactionMode, acao: (fila: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const banco = await abrirBanco()
  try {
    return await new Promise<T>((resolve, reject) => {
      const transacao = banco.transaction(FILA, modo)
      const pedido = acao(transacao.objectStore(FILA))
      transacao.oncomplete = () => resolve(pedido.result)
      transacao.onerror = () => reject(transacao.error)
      transacao.onabort = () => reject(transacao.error)
    })
  } finally {
    banco.close()
  }
}

export const listarGuardadas = () => naFila<BatidaGuardada[]>('readonly', (fila) => fila.getAll())
const tirarDaFila = (id: string) => naFila('readwrite', (fila) => fila.delete(id))
export const esvaziarFila = () => naFila('readwrite', (fila) => fila.clear())

const normalizarMatricula = (matricula: string) => matricula.replace(/^0+(?=\d)/, '')

/** Motivo para não guardar mais uma batida (limites), ou null se pode guardar. */
export function limiteAtingido(guardadas: Array<{ matricula: string }>, matricula: string): string | null {
  if (guardadas.length >= MAX_GUARDADAS) return `Sem internet, e este aparelho já guardou ${MAX_GUARDADAS} batidas. Aguarde a conexão voltar.`
  const daMatricula = guardadas.filter((g) => g.matricula === normalizarMatricula(matricula)).length
  if (daMatricula >= MAX_POR_MATRICULA) return 'Sem internet, e esta matrícula já tem muitas batidas guardadas. Aguarde a conexão voltar.'
  return null
}

/**
 * Guarda uma batida feita sem internet. Usa o mesmo id da tentativa online: se
 * ela chegou ao servidor e só a resposta se perdeu, o reenvio não duplica.
 * Devolve o horário para mostrar ao funcionário ou o motivo de não guardar.
 */
export async function guardarBatida(batida: {
  idRequisicao: string
  dispositivoId: string
  matricula: string
  pin: string
  foto: string
  miniatura: string
}): Promise<{ horario: number } | { erro: string }> {
  const referencia = lerReferencia()
  if (!referencia) return { erro: 'Sem internet, e este aparelho ainda não está preparado para guardar batidas. Tente de novo quando a conexão voltar.' }
  const limite = limiteAtingido(await listarGuardadas(), batida.matricula)
  if (limite) return { erro: limite }

  const relogioAgora = Date.now()
  const decorrido = referencia.origemDaPagina === performance.timeOrigin ? performance.now() - referencia.monotonico : null
  const pacote = await selar(referencia.chavePublica, {
    ...batida,
    horario: { ancora: referencia.ancora, relogioNaAncora: referencia.relogio, relogioAgora, decorrido },
  })
  const horario = referencia.ancora.em + (decorrido ?? relogioAgora - referencia.relogio)
  const guardada: BatidaGuardada = { id: batida.idRequisicao, matricula: normalizarMatricula(batida.matricula), horario, pacote }
  await naFila('readwrite', (fila) => fila.put(guardada))
  return { horario }
}

let envioEmAndamento: Promise<ResumoEnvio> | null = null

/**
 * Envia as batidas guardadas, da mais antiga para a mais nova. Recusas do
 * servidor (PIN errado, horário fora da janela...) saem da fila; um bloqueio
 * temporário pula a batida, e qualquer outro erro (sem internet) para o envio,
 * que é retomado depois.
 */
export function enviarGuardadas(enviar: (pacote: PacoteSelado) => Promise<ResultadoEnvio>): Promise<ResumoEnvio> {
  envioEmAndamento ??= (async () => {
    const resumo: ResumoEnvio = { enviadas: 0, recusadas: [], restantes: 0 }
    const fila = (await listarGuardadas()).sort((a, b) => a.horario - b.horario)
    for (const [indice, batida] of fila.entries()) {
      try {
        const resultado = await enviar(batida.pacote)
        await tirarDaFila(batida.id)
        if (resultado.resultado === 'recusada') resumo.recusadas.push({ matricula: batida.matricula, motivo: resultado.motivo })
        else resumo.enviadas++
      } catch (erro) {
        if (codigoErro(erro) === 'functions/resource-exhausted') {
          resumo.restantes++
          continue
        }
        resumo.restantes += fila.length - indice
        break
      }
    }
    return resumo
  })().finally(() => {
    envioEmAndamento = null
  })
  return envioEmAndamento
}

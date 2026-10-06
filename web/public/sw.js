// Service worker do ponto: mantém a tela (HTML, JS, CSS) em cache para o
// aparelho abrir mesmo se a internet cair. Dados e chamadas ao Firebase
// nunca passam por aqui: sempre vão direto para a rede.

const CACHE = 'ponto-v1'
const LIMITE_ARQUIVOS = 60
const ESSENCIAIS = ['/', '/manifest.webmanifest', '/icone.svg']

self.addEventListener('install', (evento) => {
  self.skipWaiting()
  evento.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(ESSENCIAIS)))
})

self.addEventListener('activate', (evento) => {
  evento.waitUntil(
    caches
      .keys()
      .then((chaves) => Promise.all(chaves.filter((chave) => chave !== CACHE).map((chave) => caches.delete(chave))))
      .then(() => self.clients.claim()),
  )
})

async function guardar(requisicao, resposta) {
  const cache = await caches.open(CACHE)
  await cache.put(requisicao, resposta)
  // Remove os arquivos mais antigos (de versões anteriores do site), nunca os essenciais.
  const removiveis = (await cache.keys()).filter((chave) => !ESSENCIAIS.includes(new URL(chave.url).pathname))
  for (const chave of removiveis.slice(0, Math.max(0, removiveis.length - LIMITE_ARQUIVOS))) await cache.delete(chave)
}

self.addEventListener('fetch', (evento) => {
  const requisicao = evento.request
  if (requisicao.method !== 'GET') return
  const url = new URL(requisicao.url)
  if (url.origin !== self.location.origin) return

  // Páginas: tenta a rede primeiro (versão mais nova); sem rede, usa o cache.
  if (requisicao.mode === 'navigate') {
    evento.respondWith(
      fetch(requisicao)
        .then((resposta) => {
          if (resposta.ok) void guardar('/', resposta.clone())
          return resposta
        })
        .catch(() => caches.match('/')),
    )
    return
  }

  // Arquivos com hash no nome nunca mudam: cache primeiro.
  if (url.pathname.startsWith('/assets/')) {
    evento.respondWith(
      caches.match(requisicao).then(
        (emCache) =>
          emCache ||
          fetch(requisicao).then((resposta) => {
            if (resposta.ok) void guardar(requisicao, resposta.clone())
            return resposta
          }),
      ),
    )
  }
})

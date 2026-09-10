// Local simulator fixture only. Never included in the Docker image or production entrypoints.
import express from 'express'
import { PGlite } from '@electric-sql/pglite'
import { readFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { createApp } from '../app.mjs'
import { authenticator } from '../auth.mjs'
import { domain, hash, Fault } from '../domain.mjs'
import { billingEvent } from '../billing.mjs'
import { processOne } from '../jobs.mjs'

if (process.env.NODE_ENV === 'production')
  throw new Error('Demo cannot run in production')
const pg = new PGlite()
await pg.exec(await readFile(new URL('../schema.sql', import.meta.url), 'utf8'))
const db = {
    query: (...args) => pg.query(...args),
    transaction: (fn) => pg.transaction(fn),
  },
  svc = domain(db)
const id = 'user_localfixture',
  email = 'demo@example.test'
await svc.identity(id, email)
const book = await svc.createBook(id, 'わが家の一冊')
const billing = {
  appId: 'local-demo',
  environment: 'SANDBOX',
  products: { recipe_import_10: 10 },
}
await billingEvent(
  db,
  {
    id: randomUUID(),
    type: 'NON_RENEWING_PURCHASE',
    app_id: 'local-demo',
    store: 'APP_STORE',
    environment: 'SANDBOX',
    app_user_id: id,
    product_id: 'recipe_import_10',
    transaction_id: randomUUID(),
    event_timestamp_ms: Date.now(),
  },
  billing,
)
const objects = new Map(),
  store = {
    put: async (k, v) => objects.set(k, v),
    putImage: async (k, v) => objects.set(k, v),
    get: async (k) => objects.get(k),
    getBytes: async (k) => objects.get(k),
    copy: async (source, destination) =>
      objects.set(destination, objects.get(source)),
    remove: async (k) => objects.delete(k),
    deletePrefix: async (prefix) => {
      for (const key of objects.keys()) if (key.startsWith(prefix)) objects.delete(key)
    },
  }
const cards = [
  {
    title: 'なすと豚肉の味噌炒め',
    category: '主菜',
    minutes: 20,
    servings: 2,
    ingredients: [
      { name: 'なす', amount: '2本' },
      { name: '豚こま肉', amount: '150g' },
      { name: '味噌', amount: '大さじ1' },
    ],
    steps: [
      'なすを食べやすい大きさに切る。',
      '豚肉となすを炒め、味噌を加えて全体にからめる。',
    ],
    tags: ['定番', 'なす'],
  },
  {
    title: '小松菜の煮びたし',
    category: '副菜',
    minutes: 15,
    servings: 2,
    ingredients: [
      { name: '小松菜', amount: '1束' },
      { name: '油揚げ', amount: '1枚' },
      { name: 'だし汁', amount: '200ml' },
    ],
    steps: ['小松菜と油揚げを切る。', 'だし汁で煮て、味を調える。'],
    tags: ['作り置き'],
  },
  {
    title: '豆腐とわかめのお味噌汁',
    category: '汁物',
    minutes: 10,
    servings: 2,
    ingredients: [
      { name: '豆腐', amount: '1/2丁' },
      { name: 'わかめ', amount: '適量' },
    ],
    steps: ['だし汁に豆腐とわかめを入れ、温める。', '火を止めて味噌を溶く。'],
    tags: [],
  },
]
for (const card of cards) {
  const archive = await svc.addArchive(id, book.id, {
    id: randomUUID(),
    object_key: randomUUID(),
    source_url: 'https://example.com/demo',
    sha256: hash(card.title),
  })
  objects.set(archive.object_key, `<h1>${card.title}</h1>`)
  const quote = await svc.createImportQuote(id, book.id, archive.id, {
    estimatedInputTokens: 20,
    maximumCredits: 1,
  })
  await svc.enqueue(id, book.id, archive.id, randomUUID(), quote.quoteId, 1)
  await processOne(db, store, async () => ({ card, model: 'local-fixture' }))
}
const secret = 'local-simulator-fixture-only-not-a-real-token'
const authUser = {
  id,
  email,
  aud: 'authenticated',
  role: 'authenticated',
  email_confirmed_at: new Date().toISOString(),
  app_metadata: { provider: 'email', providers: ['email'] },
  user_metadata: {},
  created_at: new Date().toISOString(),
}
const session = () => ({
  access_token: secret,
  refresh_token: secret,
  token_type: 'bearer',
  expires_in: 3600,
  expires_at: Math.floor(Date.now() / 1000) + 3600,
  user: authUser,
})
const app = express()
const authenticate = process.env.CLERK_ISSUER_URL
  ? authenticator(
      process.env.CLERK_ISSUER_URL,
      undefined,
      (process.env.CLERK_AUTHORIZED_PARTIES || '')
        .split(',')
        .map((value) => value.trim())
        .filter(Boolean),
    )
  : async (token) => {
      if (token !== secret) throw new Fault(401, 'INVALID_SESSION')
      return { id, email }
    }
app.use('/auth/v1', express.json())
app.post('/auth/v1/otp', (_req, res) => res.json({}))
app.post('/auth/v1/verify', (req, res) =>
  req.body.token === '123456' && req.body.email === email
    ? res.json(session())
    : res.status(400).json({ message: 'Use demo@example.test / 123456' }),
)
app.post('/auth/v1/token', (_req, res) => res.json(session()))
app.post('/auth/v1/logout', (_req, res) => res.sendStatus(204))
app.get('/auth/v1/user', (_req, res) => res.json(authUser))
app.use(
  createApp({
    db,
    store,
    authenticate,
    config: { webhookSecret: secret, billing },
    fetchPage: async (url) => ({ url, html: '<h1>デモのレシピ</h1>' }),
  }),
)
const port = Number(process.env.DEMO_PORT || 4329)
const server = app.listen(port, '127.0.0.1', () =>
  console.log(
    `LOCAL FIXTURE http://127.0.0.1:${port} — demo@example.test / 123456`,
  ),
)
const interval = setInterval(
  () =>
    void processOne(db, store, async () => ({
      card: cards[0],
      model: 'local-fixture',
    })).catch(() => {}),
  2000,
)
process.on('SIGTERM', () => {
  clearInterval(interval)
  server.close(async () => {
    await pg.close()
    process.exit(0)
  })
})

import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { PGlite } from '@electric-sql/pglite'
import pgDriver from 'pg'
import { database } from '../db.mjs'
import { authenticator } from '../auth.mjs'
import { generateKeyPair, exportJWK, createLocalJWKSet, SignJWT } from 'jose'
import { cardSchema, domain, hash } from '../domain.mjs'
import { billingEvent } from '../billing.mjs'
import { claimJob, finishJob, processOne, cleanupOne } from '../jobs.mjs'
import { createApp } from '../app.mjs'
import {
  imageCandidate,
  isPublicIP,
  fetchHtml,
  isSupportedImage,
} from '../fetch-html.mjs'
import {
  MAX_MODEL_OUTPUT_TOKENS,
  prepareHtml,
  validateExtraction,
  extractor,
} from '../extractor.mjs'
import { estimateImport, splitHtml, MAX_SCAN_OUTPUT_TOKENS } from '../import-cost.mjs'
import { completeRecipeJsonLd } from '../recipe-source.mjs'

let pg, db, svc, admin, testDatabase
const config = {
  appId: 'app-test',
  environments: ['SANDBOX'],
  products: { import10: 10 },
}
const card = {
  title: '卵焼き',
  category: '主菜',
  minutes: 10,
  servings: 2,
  ingredients: [{ name: '卵', amount: '2個', group: null }],
  steps: ['卵を焼く'],
  tags: [],
}
const html =
  '<html><body><h1>卵焼き</h1><p>卵 2個</p><p>卵を焼く</p></body></html>'
before(async () => {
  const sql = await readFile(new URL('../schema.sql', import.meta.url), 'utf8')
  if (process.env.TEST_POSTGRES_URL) {
    const url = new URL(process.env.TEST_POSTGRES_URL)
    if (!['127.0.0.1', 'localhost'].includes(url.hostname))
      throw new Error('Tests only allow local PostgreSQL')
    admin = new pgDriver.Pool({ connectionString: url.href })
    testDatabase = `recipe_test_${randomUUID().replaceAll('-', '')}`
    await admin.query(`CREATE DATABASE ${testDatabase}`)
    url.pathname = `/${testDatabase}`
    db = database(url.href)
    await db.query(sql)
  } else {
    pg = new PGlite()
    await pg.exec(sql)
    db = {
      query: (...args) => pg.query(...args),
      transaction: (fn) => pg.transaction(fn),
    }
  }
  svc = domain(db)
})
after(async () => {
  if (pg) await pg.close()
  if (admin) {
    await db.close()
    await admin.query(`DROP DATABASE ${testDatabase}`)
    await admin.end()
  }
})
async function actor() {
  const id = `user_${randomUUID().replaceAll('-', '')}`
  await svc.identity(id, `${id}@example.com`)
  return id
}
async function setup() {
  const user = await actor(),
    book = await svc.createBook(user, '家族')
  return { user, book: book.id }
}
async function enqueue(user, book, archive, key = randomUUID(), credits = 1) {
  const quote = await svc.createImportQuote(user, book, archive, {
    estimatedInputTokens: 100,
    maximumCredits: credits,
  })
  return svc.enqueue(user, book, archive, key, quote.quoteId, credits)
}
function event(user, overrides = {}) {
  return {
    id: randomUUID(),
    type: 'NON_RENEWING_PURCHASE',
    app_id: 'app-test',
    store: 'APP_STORE',
    environment: 'SANDBOX',
    app_user_id: user,
    product_id: 'import10',
    transaction_id: randomUUID(),
    event_timestamp_ms: Date.now(),
    ...overrides,
  }
}
async function archive(user, book) {
  return svc.addArchive(user, book, {
    id: randomUUID(),
    object_key: randomUUID(),
    source_url: 'https://example.com/recipe',
    sha256: hash(randomUUID()),
  })
}

test('invitation is email-bound, single-use, revocable; viewer cannot edit; removal is immediate', async () => {
  const { user, book } = await setup(),
    b = await actor(),
    c = await actor()
  const inv = await svc.invite(user, book, {
    email: `${b}@example.com`,
    role: 'viewer',
  })
  await assert.rejects(svc.acceptInvite(c, inv.token), {
    code: 'INVITE_UNAVAILABLE',
  })
  await svc.acceptInvite(b, inv.token)
  await svc.acceptInvite(b, inv.token)
  assert.equal((await svc.books(b)).length, 1)
  await assert.rejects(svc.renameBook(b, book, '変更不可'), {
    code: 'BOOK_ACCESS_DENIED',
  })
  await svc.renameBook(user, book, '週末のレシピ')
  assert.equal((await svc.books(b))[0].name, '週末のレシピ')
  await assert.rejects(archive(b, book), { code: 'BOOK_ACCESS_DENIED' })
  await svc.changeMember(user, book, b, 'editor')
  await archive(b, book)
  await svc.changeMember(user, book, b, null)
  await assert.rejects(svc.recipes(b, book), { code: 'BOOK_ACCESS_DENIED' })
  // Consumed invite does not restore a removed member.
  await svc.acceptInvite(b, inv.token)
  assert.equal((await svc.books(b)).length, 0)
  const revoked = await svc.invite(user, book, {
    email: `${c}@example.com`,
    role: 'viewer',
  })
  await svc.revokeInvite(user, book, revoked.id)
  await assert.rejects(svc.acceptInvite(c, revoked.token), {
    code: 'INVITE_UNAVAILABLE',
  })
})
test('HTML is private to its creator even for another owner/editor', async () => {
  const { user, book } = await setup(),
    b = await actor(),
    a = await archive(user, book)
  const inv = await svc.invite(user, book, {
    email: `${b}@example.com`,
    role: 'editor',
  })
  await svc.acceptInvite(b, inv.token)
  await assert.rejects(svc.archive(b, a.id), { code: 'ARCHIVE_NOT_FOUND' })
  assert.deepEqual(await svc.archives(b, book), [])
})
test('archive history is searchable and cursor-paginated without exposing another creator', async () => {
  const { user, book } = await setup(),
    editor = await actor()
  const invitation = await svc.invite(user, book, {
    email: `${editor}@example.com`,
    role: 'editor',
  })
  await svc.acceptInvite(editor, invitation.token)
  for (let i = 0; i < 35; i += 1)
    await svc.addArchive(user, book, {
      id: randomUUID(),
      object_key: randomUUID(),
      source_url: `https://example.com/recipes/${String(i).padStart(2, '0')}`,
      sha256: hash(randomUUID()),
    })
  const first = await svc.archivePage(user, book, { limit: 30 })
  assert.equal(first.total, 35)
  assert.equal(first.items.length, 30)
  assert.ok(first.nextCursor)
  const second = await svc.archivePage(user, book, {
    limit: 30,
    beforeCreatedAt: first.nextCursor.createdAt,
    beforeId: first.nextCursor.id,
  })
  assert.equal(second.items.length, 5)
  assert.equal(second.nextCursor, null)
  assert.equal(
    new Set([...first.items, ...second.items].map((item) => item.id)).size,
    35,
  )
  const searched = await svc.archivePage(user, book, { query: '/07' })
  assert.equal(searched.total, 1)
  assert.match(searched.items[0].source_url, /\/07$/)
  assert.equal(
    (await svc.archivePage(user, book, { status: 'attention' })).total,
    35,
  )
  assert.equal((await svc.archivePage(user, book, { status: 'active' })).total, 0)
  assert.equal((await svc.archivePage(editor, book)).total, 0)
})
test('saved source image follows the card and is readable by family members', async () => {
  const { user, book } = await setup(),
    viewer = await actor(),
    outsider = await actor(),
    imageKey = `users/${user}/archives/${randomUUID()}.image`,
    objects = new Map([[imageKey, Buffer.from('image-bytes')]])
  const invitation = await svc.invite(user, book, {
    email: `${viewer}@example.com`,
    role: 'viewer',
  })
  await svc.acceptInvite(viewer, invitation.token)
  await billingEvent(db, event(user), config)
  const source = await svc.addArchive(user, book, {
    id: randomUUID(),
    object_key: randomUUID(),
    image_key: imageKey,
    image_content_type: 'image/png',
    source_url: 'https://example.com/recipe',
    sha256: hash(randomUUID()),
  })
  objects.set(source.object_key, html)
  await enqueue(user, book, source.id, randomUUID())
  await processOne(
    db,
    {
      get: async (key) => objects.get(key),
      copy: async (from, to) => objects.set(to, objects.get(from)),
    },
    async () => ({ card }),
  )
  const recipe = (await svc.recipes(user, book))[0]
  assert.equal(recipe.has_image, true)
  const familyImage = await svc.recipeImage(viewer, recipe.id)
  assert.deepEqual(objects.get(familyImage.image_key), Buffer.from('image-bytes'))
  await assert.rejects(svc.recipeImage(outsider, recipe.id), {
    code: 'IMAGE_NOT_FOUND',
  })
})
test('billing replay and transaction replay credit only once; refunds and reversal are ordered', async () => {
  const user = await actor(),
    e = event(user)
  await billingEvent(db, e, config)
  await billingEvent(db, e, config)
  await billingEvent(db, { ...e, id: randomUUID() }, config)
  assert.equal((await svc.wallet(user)).balance, 10)
  await billingEvent(
    db,
    {
      ...e,
      id: randomUUID(),
      type: 'CANCELLATION',
      event_timestamp_ms: e.event_timestamp_ms + 1,
    },
    config,
  )
  await billingEvent(
    db,
    {
      ...e,
      id: randomUUID(),
      type: 'CANCELLATION',
      event_timestamp_ms: e.event_timestamp_ms + 2,
    },
    config,
  )
  assert.equal((await svc.wallet(user)).balance, 0)
  await billingEvent(
    db,
    {
      ...e,
      id: randomUUID(),
      type: 'REFUND_REVERSED',
      event_timestamp_ms: e.event_timestamp_ms + 3,
    },
    config,
  )
  await billingEvent(
    db,
    {
      ...e,
      id: randomUUID(),
      type: 'CANCELLATION',
      event_timestamp_ms: e.event_timestamp_ms + 2,
    },
    config,
  )
  assert.equal((await svc.wallet(user)).balance, 10)
})
test('refund before purchase, wrong app/env/product/owner and unauthenticated purchase never grant', async () => {
  const user = await actor(),
    e = event(user)
  await billingEvent(db, { ...e, type: 'CANCELLATION' }, config)
  await billingEvent(db, { ...e, id: randomUUID() }, config)
  assert.equal((await svc.wallet(user)).balance, 0)
  for (const override of [
    { environment: 'PRODUCTION' },
    { app_id: 'wrong' },
    { product_id: 'unknown' },
  ])
    await assert.rejects(billingEvent(db, event(user, override), config))
  await assert.rejects(
    billingEvent(
      db,
      { ...e, id: randomUUID(), app_user_id: await actor() },
      config,
    ),
    { code: 'TRANSACTION_OWNER_MISMATCH' },
  )
})
test('production billing config can accept TestFlight sandbox purchases', async () => {
  const user = await actor()
  await billingEvent(db, event(user), {
    ...config,
    environments: ['PRODUCTION', 'SANDBOX'],
  })
  assert.equal((await svc.wallet(user)).balance, 10)
})
test('one credit cannot be reserved twice; request replay is stable; successful job debits once', async () => {
  const { user, book } = await setup()
  await billingEvent(db, event(user, { product_id: 'one' }), {
    ...config,
    products: { one: 1 },
  })
  const a = await archive(user, book),
    b = await archive(user, book),
    key = randomUUID()
  const results = await Promise.allSettled([
    enqueue(user, book, a.id, key),
    enqueue(user, book, b.id, randomUUID()),
  ])
  assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1)
  const j = results[0].value
  assert.equal((await enqueue(user, book, a.id, key)).id, j.id)
  const claimed = await claimJob(db)
  await finishJob(db, claimed, { card, model: 'test', usage: {} })
  await finishJob(db, claimed, { card, model: 'test', usage: {} })
  assert.equal((await svc.recipes(user, book)).length, 1)
  assert.equal((await svc.wallet(user)).balance, 0)
  assert.equal((await svc.wallet(user)).reserved, 0)
})
test('multi-credit quote reserves its maximum and settles actual usage', async () => {
  const { user, book } = await setup()
  await billingEvent(db, event(user), config)
  const a = await archive(user, book)
  const job = await enqueue(user, book, a.id, randomUUID(), 3)
  assert.equal((await svc.wallet(user)).reserved, 3)
  const claimed = await claimJob(db)
  assert.equal(claimed.id, job.id)
  await finishJob(db, claimed, {
    card,
    model: 'test',
    usage: {},
    creditsUsed: 2,
  })
  const wallet = await svc.wallet(user)
  assert.equal(wallet.balance, 8)
  assert.equal(wallet.reserved, 0)
  assert.equal(wallet.ledger[0].delta, -2)
})
test('LLM failure/review release reservation; retry creates new job; stale lease cannot commit', async () => {
  const { user, book } = await setup()
  await billingEvent(db, event(user), config)
  const a = await archive(user, book)
  await enqueue(user, book, a.id, randomUUID())
  await processOne(db, { get: async () => html }, async () => {
    throw new Error('timeout')
  })
  assert.equal((await svc.wallet(user)).available, 10)
  await enqueue(user, book, a.id, randomUUID())
  const old = await claimJob(db)
  await db.query(
    "UPDATE jobs SET lease_until=now()-interval '1 second' WHERE id=$1",
    [old.id],
  )
  const fresh = await claimJob(db)
  assert.equal((await finishJob(db, old, { card })).stale, true)
  await finishJob(db, fresh, { card: null })
  assert.equal((await svc.wallet(user)).available, 10)
  assert.equal((await svc.recipes(user, book)).length, 0)
})
test('membership removal during model request discards card and releases reservation', async () => {
  const { user, book } = await setup(),
    b = await actor()
  const inv = await svc.invite(user, book, {
    email: `${b}@example.com`,
    role: 'editor',
  })
  await svc.acceptInvite(b, inv.token)
  await billingEvent(db, event(b), config)
  const a = await archive(b, book)
  await enqueue(b, book, a.id, randomUUID())
  const j = await claimJob(db)
  await svc.changeMember(user, book, b, null)
  assert.equal((await finishJob(db, j, { card })).status, 'failed')
  assert.equal((await svc.wallet(b)).available, 10)
})
test('plans and cards reject cross-book IDs and stale edits', async () => {
  const { user, book } = await setup()
  await billingEvent(db, event(user), config)
  const a = await archive(user, book)
  await enqueue(user, book, a.id, randomUUID())
  await processOne(db, { get: async () => html }, async () => ({ card }))
  const r = (await svc.recipes(user, book))[0]
  await svc.updateRecipe(user, book, r.id, {
    version: r.version,
    card,
    memo: '家族用',
  })
  await assert.rejects(
    svc.updateRecipe(user, book, r.id, { version: r.version, card, memo: '' }),
    { code: 'EDIT_CONFLICT' },
  )
  const items = [
    { id: randomUUID(), recipeId: r.id, state: 'cook', portions: 3 },
  ]
  await svc.savePlan(user, book, '2026-09-06', { version: 0, items })
  await assert.rejects(
    svc.savePlan(user, book, '2026-09-06', { version: 0, items }),
    { code: 'EDIT_CONFLICT' },
  )
  const other = await svc.createBook(user, '別冊')
  await assert.rejects(
    svc.savePlan(user, other.id, '2026-09-06', { version: 0, items }),
    { code: 'INVALID_RECIPE' },
  )
})
test('deletion requires ownership transfer, disables immediately, cleanup retries safely', async () => {
  const { user, book } = await setup(),
    b = await actor()
  const inv = await svc.invite(user, book, {
    email: `${b}@example.com`,
    role: 'viewer',
  })
  await svc.acceptInvite(b, inv.token)
  await assert.rejects(svc.deleteAccount(user), {
    code: 'TRANSFER_OWNERSHIP_FIRST',
  })
  await svc.transfer(user, book, b)
  const a = await archive(user, book)
  await svc.deleteAccount(user)
  await assert.rejects(svc.identity(user, `${user}@example.com`), {
    code: 'ACCOUNT_DISABLED',
  })
  await assert.rejects(
    cleanupOne(
      db,
      {
        deleteUser: async () => {
          throw new Error('offline')
        },
        deletePrefix: async () => {},
      },
      async () => {},
    ),
  )
  await cleanupOne(
    db,
    { deleteUser: async () => {}, deletePrefix: async () => {} },
    async () => {},
  )
  assert.equal(
    (await db.query('SELECT id FROM archives WHERE id=$1', [a.id])).rows.length,
    0,
  )
  assert.equal((await svc.books(b)).length, 1)
})
test('SSRF blocks all non-public IPv4/IPv6 including mapped and metadata ranges', async () => {
  for (const ip of [
    '127.0.0.1',
    '10.0.0.1',
    '169.254.169.254',
    '100.64.0.1',
    '0.0.0.0',
    '192.168.0.1',
    '::1',
    'fc00::1',
    '::ffff:127.0.0.1',
    'fe80::1',
    '224.0.0.1',
  ])
    assert.equal(isPublicIP(ip), false, ip)
  assert.equal(isPublicIP('8.8.8.8'), true)
  await assert.rejects(
    fetchHtml('https://example.com', {
      lookup: async () => [{ address: '127.0.0.1', family: 4 }],
    }),
    { code: 'PRIVATE_URL_DENIED' },
  )
})
test('recipe image selection prefers JSON-LD and resolves relative URLs', () => {
  assert.equal(
    imageCandidate(
      `<html><head>
        <meta property="og:image" content="/fallback.jpg">
        <script type="application/ld+json">{
          "@type":"Recipe","image":{"url":"../images/dish.png"}
        }</script>
      </head><body><main><img src="/body.jpg"></main></body></html>`,
      'https://example.com/recipes/tamagoyaki/',
    ),
    'https://example.com/recipes/images/dish.png',
  )
  assert.equal(
    imageCandidate(
      '<meta property="og:image" content="/fallback.jpg">',
      'https://example.com/recipe',
    ),
    'https://example.com/fallback.jpg',
  )
})
test('recipe image fetch accepts validated AVIF responses', async () => {
  const avif = Buffer.concat([
    Buffer.from([0, 0, 0, 24]),
    Buffer.from('ftypavif'),
    Buffer.from([0, 0, 0, 0]),
    Buffer.from('avifmif1'),
  ])
  assert.equal(isSupportedImage('image/avif', avif), true)
  assert.equal(isSupportedImage('image/avif', Buffer.from('not-an-image')), false)
})
test('extraction retains source evidence and rejects fabricated ingredients/refusal/incomplete output', async () => {
  assert.equal(
    cardSchema.safeParse({
      ...card,
      ingredients: [{ name: '卵', amount: '2個' }],
    }).success,
    true,
  )
  const source = prepareHtml(html)
  assert.deepEqual(
    validateExtraction(
      { isRecipe: true, reason: '', evidence: ['卵焼き'], recipe: card },
      source,
    ),
    card,
  )
  assert.equal(
    validateExtraction(
      {
        isRecipe: true,
        reason: '',
        evidence: ['卵焼き'],
        recipe: { ...card, ingredients: [{ name: '砂糖', amount: '10g', group: null }] },
      },
      source,
    ),
    null,
  )
  const punctuationSource = prepareHtml(
    '<h1>煮びたし</h1><p>なす 2本</p><p>なすを縦半分に切り、鍋でやわらかくなるまで煮る。</p>',
  )
  assert.ok(
    validateExtraction(
      {
        isRecipe: true,
        reason: '',
        evidence: [
          '煮びたし',
          'なす 2本',
          'なすを縦半分に切り鍋でやわらかくなるまで煮る。',
        ],
        recipe: {
          title: '煮びたし',
          category: '副菜',
          minutes: null,
          servings: null,
          ingredients: [{ name: 'なす', amount: '2本', group: null }],
          steps: ['なすを縦半分に切り鍋でやわらかくなるまで煮る。'],
          tags: [],
        },
      },
      punctuationSource,
    ),
  )
  const groupedSource = prepareHtml(
    '<h1>煮びたし</h1><p>なす 2本</p><h2>（A）</h2><p>水 150ml</p><p>（A）を加えて煮る。</p>',
  )
  const groupedCard = {
    ...card,
    title: '煮びたし',
    ingredients: [
      { name: 'なす', amount: '2本', group: null },
      { name: '水', amount: '150ml', group: '（A）' },
    ],
    steps: ['（A）を加えて煮る。'],
  }
  assert.deepEqual(
    validateExtraction(
      {
        isRecipe: true,
        reason: '',
        evidence: ['煮びたし', '（A）', '水 150ml'],
        recipe: groupedCard,
      },
      groupedSource,
    ),
    groupedCard,
  )
  assert.equal(
    validateExtraction(
      {
        isRecipe: true,
        reason: '',
        evidence: ['煮びたし', '水 150ml'],
        recipe: {
          ...groupedCard,
          ingredients: groupedCard.ingredients.map((ingredient) =>
            ingredient.name === '水'
              ? { ...ingredient, group: '合わせ調味料' }
              : ingredient,
          ),
        },
      },
      groupedSource,
    ),
    null,
  )
  const env = { OPENAI_API_KEY: 'test-only', OPENAI_MODEL: 'configured-model' }
  let modelCalls = 0
  const run = extractor(env, async (_url, request) => {
    const body = JSON.parse(request.body)
    assert.equal(body.store, false)
    assert.equal(body.text.format.type, 'json_schema')
    modelCalls++
    if (modelCalls === 1) {
      assert.equal(body.max_output_tokens, MAX_SCAN_OUTPUT_TOKENS)
      return {
        ok: true,
        json: async () => ({
          status: 'completed', model: 'scan', usage: {},
          output: [{ content: [{ type: 'output_text', text: JSON.stringify({
            classification: 'single', candidateId: 'recipe-1', evidence: ['卵焼き'],
            needsPrevious: false, needsNext: false,
          }) }] }],
        }),
      }
    }
    assert.equal(body.max_output_tokens, MAX_MODEL_OUTPUT_TOKENS)
    const recipeSchema = body.text.format.schema.properties.recipe.anyOf.find(
      (option) => option.type === 'object',
    )
    assert.ok(recipeSchema.properties.ingredients.items.required.includes('group'))
    return {
      ok: true,
      json: async () => ({
        status: 'completed',
        output: [{ content: [{ type: 'refusal' }] }],
      }),
    }
  })
  assert.equal((await run(html)).card, null)
  await assert.rejects(
    extractor(env, async () => ({
      ok: true,
      json: async () => ({ status: 'incomplete' }),
    }))(html),
    /MODEL_INCOMPLETE/,
  )
})
test('completed model phases are reused from checkpoints', async () => {
  const saved = new Map()
  let calls = 0
  const run = extractor(
    { OPENAI_API_KEY: 'test-only', OPENAI_MODEL: 'configured-model' },
    async (_url, request) => {
      calls++
      const body = JSON.parse(request.body)
      const value =
        body.max_output_tokens === MAX_SCAN_OUTPUT_TOKENS
          ? {
              classification: 'single',
              candidateId: '卵焼き',
              evidence: ['卵焼き'],
              needsPrevious: false,
              needsNext: false,
            }
          : { isRecipe: true, reason: '', evidence: ['卵焼き'], recipe: card }
      return {
        ok: true,
        json: async () => ({
          status: 'completed',
          model: body.model,
          usage: { input_tokens: 10, output_tokens: 10 },
          output: [{ content: [{ type: 'output_text', text: JSON.stringify(value) }] }],
        }),
      }
    },
  )
  const checkpoint = {
    load: async (phase, index, hash) => saved.get(`${phase}:${index}:${hash}`),
    save: async (phase, index, hash, value) => saved.set(`${phase}:${index}:${hash}`, value),
  }
  assert.deepEqual((await run(html, checkpoint)).card, card)
  assert.equal(calls, 2)
  assert.deepEqual((await run(html, checkpoint)).card, card)
  assert.equal(calls, 2)
})
test('long HTML is split without loss and receives a token-based quote', () => {
  const long = `<html><body>${'長いレシピ'.repeat(500)}</body></html>`
  const chunks = splitHtml(long, 1000)
  assert.ok(chunks.length > 1)
  assert.equal(chunks.join(''), long)
  const estimate = estimateImport(long)
  assert.ok(estimate.estimatedInputTokens > 1000)
  assert.ok(estimate.maximumCredits >= 1)
})
test('one complete Recipe JSON-LD constrains full-page fragment scans', () => {
  const source = `<html><body>
    <script type="application/ld+json">{
      "@context":"https://schema.org",
      "@graph":[{"@type":"Recipe","@id":"recipe-1","name":"ハムカツ",
        "recipeIngredient":["ハム 16枚","パン粉 50g"],
        "recipeInstructions":[{"@type":"HowToStep","text":"ハムを揚げる。"}]}]
    }</script>
    <h1>ハムカツ</h1><p>ハム 16枚</p><p>ハムを揚げる。</p>
    <aside>関連レシピ: チーズハムカツ、揚げないハムカツ、コロッケ</aside>
  </body></html>`
  const candidate = completeRecipeJsonLd(source)
  assert.ok(candidate)
  assert.equal(JSON.parse(candidate).name, 'ハムカツ')
  assert.equal(candidate.includes('関連レシピ'), false)
  const estimate = estimateImport(source)
  assert.equal(estimate.structuredRecipe, candidate)
  assert.equal(estimate.chunks.join(''), source)
})
test('extractor uses Recipe JSON-LD as the target while retaining visible HTML context', async () => {
  const source = `<script type="application/ld+json">{
    "@type":"Recipe","name":"卵焼き","recipeIngredient":["卵 2個"],
    "recipeInstructions":[{"@type":"HowToStep","text":"（A）の卵を焼く"}]
  }</script><h1>卵焼き</h1><h2>（A）</h2><p>卵 2個</p><p>（A）の卵を焼く</p><aside>関連レシピ: オムレツ</aside>`
  const inputs = [], instructions = []
  const targetCard = {
    ...card,
    ingredients: [{ name: '卵', amount: '2個', group: '（A）' }],
    steps: ['（A）の卵を焼く'],
  }
  const run = extractor(
    { OPENAI_API_KEY: 'test-only', OPENAI_MODEL: 'configured-model' },
    async (_url, request) => {
      const body = JSON.parse(request.body)
      inputs.push(body.input)
      instructions.push(body.instructions)
      const value =
        body.max_output_tokens === MAX_SCAN_OUTPUT_TOKENS
          ? {
              classification: 'single', candidateId: '卵焼き',
              evidence: ['卵焼き'], needsPrevious: false, needsNext: false,
            }
          : {
              isRecipe: true,
              reason: '',
              evidence: ['卵焼き', '（A）', '卵 2個'],
              recipe: targetCard,
            }
      return {
        ok: true,
        json: async () => ({
          status: 'completed', model: body.model, usage: {},
          output: [{ content: [{ type: 'output_text', text: JSON.stringify(value) }] }],
        }),
      }
    },
  )
  assert.deepEqual((await run(source)).card, targetCard)
  assert.equal(inputs.length, 2)
  assert.ok(inputs.every((input) => input.includes('Primary Recipe JSON-LD')))
  assert.ok(inputs.every((input) => input.includes('関連レシピ')))
  assert.match(instructions[0], /related recipes/)
})
test('missing, incomplete, malformed, or multiple Recipe JSON-LD falls back to full HTML', () => {
  const cases = [
    '<html><body><h1>卵焼き</h1></body></html>',
    '<script type="application/ld+json">{"@type":"Recipe","name":"卵焼き"}</script><p>本文</p>',
    '<script type="application/ld+json">{broken</script><p>本文</p>',
    `<script type="application/ld+json">[{"@type":"Recipe","name":"A","recipeIngredient":["卵"],"recipeInstructions":["焼く"]},{"@type":"Recipe","name":"B","recipeIngredient":["米"],"recipeInstructions":["炊く"]}]</script>`,
  ]
  for (const source of cases) {
    assert.equal(completeRecipeJsonLd(source), null)
    assert.equal(estimateImport(source).chunks.join(''), source)
  }
})
test('HTTP requires auth and webhook secret, validates IDs, uploads without public HTML routes', async () => {
  const { user, book } = await setup(),
    successor = await actor(),
    objects = new Map(),
    imageHtml = `${html}<meta property="og:image" content="/dish.png">`,
    imageBytes = Buffer.from('private-image')
  const app = createApp({
    db,
    store: {
      put: async (k, v) => objects.set(k, v),
      putImage: async (k, v) => objects.set(k, v),
      get: async (k) => objects.get(k),
      getBytes: async (k) => objects.get(k),
      copy: async (source, destination) =>
        objects.set(destination, objects.get(source)),
      remove: async (k) => objects.delete(k),
    },
    authenticate: async (token) => {
      if (token !== user) throw new Error('bad')
      return { id: user, email: `${user}@example.com` }
    },
    config: { webhookSecret: 'test-secret', billing: config },
    fetchPageImage: async () => ({
      buffer: imageBytes,
      contentType: 'image/png',
    }),
  })
  const server = app.listen(0, '127.0.0.1')
  await new Promise((resolve) => server.once('listening', resolve))
  const url = `http://127.0.0.1:${server.address().port}`
  try {
    assert.equal((await fetch(`${url}/v1/books`)).status, 401)
    assert.equal(
      (
        await fetch(`${url}/webhooks/revenuecat`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: '{}',
        })
      ).status,
      401,
    )
    const response = await fetch(`${url}/v1/books/${book}/archives`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${user}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ url: 'https://example.com', html: imageHtml }),
    })
    assert.equal(response.status, 201)
    const a = await response.json()
    const historyResponse = await fetch(
      `${url}/v1/books/${book}/archive-history?limit=1&query=example.com`,
      { headers: { Authorization: `Bearer ${user}` } },
    )
    assert.equal(historyResponse.status, 200)
    const history = await historyResponse.json()
    assert.equal(history.total, 1)
    assert.equal(history.items[0].id, a.id)
    assert.equal(history.nextCursor, null)
    assert.equal(
      (
        await fetch(`${url}/v1/books/${book}/archive-history?cursor=broken`, {
          headers: { Authorization: `Bearer ${user}` },
        })
      ).status,
      400,
    )
    const raw = await fetch(`${url}/v1/archives/${a.id}/html`, {
      headers: { Authorization: `Bearer ${user}` },
    })
    assert.equal(
      raw.headers.get('content-type'),
      'application/octet-stream; charset=utf-8',
    )
    assert.match(raw.headers.get('content-disposition'), /attachment/)
    await billingEvent(db, event(user), config)
    const quoteResponse = await fetch(
      `${url}/v1/books/${book}/archives/${a.id}/import-quote`,
      { method: 'POST', headers: { Authorization: `Bearer ${user}` } },
    )
    assert.equal(quoteResponse.status, 201)
    const quote = await quoteResponse.json()
    assert.equal(quote.maximumCredits, 1)
    const importResponse = await fetch(`${url}/v1/books/${book}/imports`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${user}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        archiveId: a.id,
        requestKey: randomUUID(),
        consent: true,
      }),
    })
    assert.equal(importResponse.status, 202)
    await processOne(
      db,
      {
        get: async (key) => objects.get(key),
        copy: async (from, to) => objects.set(to, objects.get(from)),
      },
      async () => ({ card }),
    )
    const recipe = (await svc.recipes(user, book))[0]
    const recipeImage = await fetch(`${url}/v1/recipes/${recipe.id}/image`, {
      headers: { Authorization: `Bearer ${user}` },
    })
    assert.equal(recipeImage.status, 200)
    assert.equal(recipeImage.headers.get('content-type'), 'image/png')
    assert.deepEqual(Buffer.from(await recipeImage.arrayBuffer()), imageBytes)
    assert.equal(
      (
        await fetch(`${url}/v1/books/not-a-uuid/recipes`, {
          headers: { Authorization: `Bearer ${user}` },
        })
      ).status,
      400,
    )
    const invitation = await svc.invite(user, book, {
      email: `${successor}@example.com`,
      role: 'viewer',
    })
    await svc.acceptInvite(successor, invitation.token)
    assert.equal(
      (
        await fetch(`${url}/v1/books/${book}/owner`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${user}`,
            'content-type': 'application/json',
          },
          body: JSON.stringify({ userId: successor }),
        })
      ).status,
      204,
    )
  } finally {
    await new Promise((resolve) => server.close(resolve))
  }
})

test('Clerk JWT verifies signature, issuer, authorized party, expiry and identity', async () => {
  const { privateKey, publicKey } = await generateKeyPair('RS256')
  const jwk = await exportJWK(publicKey),
    issuer = 'https://test.clerk.accounts.dev'
  const authenticate = authenticator(
    issuer,
    createLocalJWKSet({ keys: [{ ...jwk, kid: 'test' }] }),
    ['wagayarecipe://'],
  )
  const id = 'user_test123'
  const token = (patch = {}) =>
    new SignJWT({
      sub: id,
      email: 'user@example.com',
      iss: issuer,
      azp: 'wagayarecipe://',
      exp: Math.floor(Date.now() / 1000) + 60,
      ...patch,
    })
      .setProtectedHeader({ alg: 'RS256', kid: 'test' })
      .sign(privateKey)
  assert.equal((await authenticate(await token())).id, id)
  assert.equal((await authenticate(await token({ azp: undefined }))).id, id)
  for (const patch of [
    { iss: 'https://attacker.example' },
    { azp: 'https://attacker.example' },
    { exp: 1 },
    { sub: 'not-a-clerk-user' },
  ])
    await assert.rejects(authenticate(await token(patch)), {
      code: 'INVALID_SESSION',
    })
  await assert.rejects(authenticate('not-a-jwt'), { code: 'INVALID_SESSION' })
})

test('deleting last owner preserves former member reservations until worker refunds them', async () => {
  const { user, book } = await setup(),
    b = await actor()
  const inv = await svc.invite(user, book, {
    email: `${b}@example.com`,
    role: 'editor',
  })
  await svc.acceptInvite(b, inv.token)
  await billingEvent(db, event(b), config)
  const a = await archive(b, book)
  await enqueue(b, book, a.id, randomUUID())
  await svc.changeMember(user, book, b, null)
  await svc.deleteAccount(user)
  await cleanupOne(
    db,
    { deleteUser: async () => {}, deletePrefix: async () => {} },
    async () => {},
  )
  assert.equal((await svc.wallet(b)).reserved, 1)
  await processOne(db, { get: async () => html }, async () => ({ card }))
  assert.equal((await svc.wallet(b)).available, 10)
})

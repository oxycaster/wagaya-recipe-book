import express from 'express'
import { rateLimit } from 'express-rate-limit'
import { randomUUID, timingSafeEqual } from 'node:crypto'
import { z } from 'zod'
import {
  domain,
  member,
  Fault,
  requireThat,
  hash,
  uuid,
  userId,
} from './domain.mjs'
import { billingEvent } from './billing.mjs'
import {
  fetchHtml,
  fetchImage,
  imageCandidate,
  pageUrl,
  MAX_HTML_BYTES,
} from './fetch-html.mjs'

export function createApp({
  db,
  store,
  authenticate,
  config,
  fetchPage = fetchHtml,
  fetchPageImage = fetchImage,
}) {
  const app = express(),
    service = domain(db)
  app.disable('x-powered-by')
  app.use((_req, res, next) => {
    res.set({
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    })
    next()
  })
  app.get('/health', async (_req, res) => {
    await db.query('SELECT 1')
    res.json({ ok: true })
  })
  app.post(
    '/webhooks/revenuecat',
    express.json({ limit: '64kb' }),
    async (req, res) => {
      const expected = Buffer.from(`Bearer ${config.webhookSecret}`),
        actual = Buffer.from(req.headers.authorization || '')
      requireThat(
        actual.length === expected.length && timingSafeEqual(actual, expected),
        401,
        'INVALID_WEBHOOK',
      )
      res.json(await billingEvent(db, req.body.event, config.billing))
    },
  )
  app.use(
    '/v1',
    rateLimit({
      windowMs: 60000,
      limit: 120,
      standardHeaders: 'draft-8',
      legacyHeaders: false,
    }),
    express.json({ limit: '3mb' }),
  )
  app.use('/v1', async (req, _res, next) => {
    const token = req.headers.authorization?.match(/^Bearer (.+)$/)?.[1]
    if (!token) throw new Fault(401, 'SIGN_IN_REQUIRED')
    req.actor = await authenticate(token)
    await service.identity(req.actor.id, req.actor.email)
    next()
  })
  app.param(['book', 'id'], (req, _res, next, value) => {
    uuid.parse(value)
    next()
  })
  app.param('target', (req, _res, next, value) => {
    userId.parse(value)
    next()
  })
  const user = (req) => req.actor.id
  const day = (req) => z.iso.date().parse(req.params.day)
  app.get('/v1/me', async (req, res) =>
    res.json({ id: user(req), email: req.actor.email }),
  )
  app.get('/v1/books', async (req, res) =>
    res.json(await service.books(user(req))),
  )
  app.post('/v1/books', async (req, res) =>
    res.status(201).json(await service.createBook(user(req), req.body.name)),
  )
  app.patch('/v1/books/:book', async (req, res) =>
    res.json(
      await service.renameBook(user(req), req.params.book, req.body.name),
    ),
  )
  app.post('/v1/books/:book/invites', async (req, res) =>
    res
      .status(201)
      .json(await service.invite(user(req), req.params.book, req.body)),
  )
  app.post('/v1/invites/accept', async (req, res) =>
    res.json(await service.acceptInvite(user(req), req.body.token)),
  )
  app.get('/v1/books/:book/family', async (req, res) =>
    res.json(await service.family(user(req), req.params.book)),
  )
  app.delete('/v1/books/:book/invites/:id', async (req, res) => {
    await service.revokeInvite(user(req), req.params.book, req.params.id)
    res.sendStatus(204)
  })
  app.patch('/v1/books/:book/members/:target', async (req, res) => {
    await service.changeMember(
      user(req),
      req.params.book,
      req.params.target,
      req.body.role,
    )
    res.sendStatus(204)
  })
  app.post('/v1/books/:book/owner', async (req, res) => {
      await service.transfer(
        user(req),
        req.params.book,
        userId.parse(req.body.userId),
      )
    res.sendStatus(204)
  })
  app.get('/v1/books/:book/archives', async (req, res) =>
    res.json(await service.archives(user(req), req.params.book)),
  )
  app.post(
    '/v1/books/:book/archives',
    rateLimit({ windowMs: 60000, limit: 10, keyGenerator: (req) => user(req) }),
    async (req, res) => {
      await service.run(user(req), (c) =>
        member(c, user(req), req.params.book, ['owner', 'editor']),
      )
      const input = z
        .object({
          url: z.string().url().max(4096),
          html: z.string().min(1).optional(),
        })
        .parse(req.body)
      let page = { url: pageUrl(input.url).href, html: input.html }
      if (!page.html) page = await fetchPage(input.url)
      requireThat(
        Buffer.byteLength(page.html, 'utf8') <= MAX_HTML_BYTES,
        413,
        'HTML_TOO_LARGE',
      )
      const id = randomUUID(),
        key = `users/${user(req)}/archives/${id}.html`,
        candidate = imageCandidate(page.html, page.url)
      let image = null
      if (candidate) {
        try {
          image = await fetchPageImage(candidate)
        } catch {
          // A recipe remains useful when a protected or unsupported image cannot be saved.
        }
      }
      const imageKey = image
        ? `users/${user(req)}/archives/${id}.image`
        : null
      try {
        const archive = await service.addArchive(
          user(req),
          req.params.book,
          {
            id,
            object_key: key,
            image_key: imageKey,
            image_content_type: image?.contentType,
            source_url: page.url,
            sha256: hash(page.html),
          },
          async () => {
            await store.put(key, page.html)
            if (imageKey)
              await store.putImage(imageKey, image.buffer, image.contentType)
          },
        )
        res.status(201).json({ id: archive.id, source_url: archive.source_url })
      } catch (e) {
        await store.remove(key).catch(() => {})
        if (imageKey) await store.remove(imageKey).catch(() => {})
        throw e
      }
    },
  )
  app.get('/v1/archives/:id/html', async (req, res) => {
    const a = await service.archive(user(req), req.params.id)
    res
      .set({
        'Content-Type': 'application/octet-stream',
        'Content-Disposition': `attachment; filename="recipe-${a.id}.html"`,
        'Content-Security-Policy': "sandbox; default-src 'none'",
      })
      .send(await store.get(a.object_key))
  })
  app.post('/v1/books/:book/imports', async (req, res) => {
    const input = z
      .object({ archiveId: uuid, requestKey: uuid, consent: z.literal(true) })
      .parse(req.body)
    const j = await service.enqueue(
      user(req),
      req.params.book,
      input.archiveId,
      input.requestKey,
    )
    res.status(202).json({ id: j.id, status: j.status })
  })
  app.get('/v1/wallet', async (req, res) =>
    res.json(await service.wallet(user(req))),
  )
  app.get('/v1/products', (_req, res) =>
    res.json(
      Object.entries(config.billing.products).map(([id, credits]) => ({
        id,
        credits,
      })),
    ),
  )
  app.get('/v1/books/:book/recipes', async (req, res) =>
    res.json(await service.recipes(user(req), req.params.book)),
  )
  app.get('/v1/recipes/:id/image', async (req, res) => {
    const image = await service.recipeImage(user(req), req.params.id)
    res
      .set({
        'Content-Type': image.image_content_type,
        'Content-Disposition': `inline; filename="recipe-${req.params.id}"`,
        'Cache-Control': 'private, max-age=3600',
        'Content-Security-Policy': "default-src 'none'",
      })
      .send(await store.getBytes(image.image_key))
  })
  app.put('/v1/books/:book/recipes/:id', async (req, res) =>
    res.json(
      await service.updateRecipe(
        user(req),
        req.params.book,
        req.params.id,
        req.body,
      ),
    ),
  )
  app.get('/v1/books/:book/plans/:day', async (req, res) =>
    res.json(await service.plan(user(req), req.params.book, day(req))),
  )
  app.put('/v1/books/:book/plans/:day', async (req, res) =>
    res.json(
      await service.savePlan(user(req), req.params.book, day(req), req.body),
    ),
  )
  app.delete('/v1/me', async (req, res) => {
    requireThat(
      req.body.confirm === 'DELETE',
      400,
      'DELETE_CONFIRMATION_REQUIRED',
    )
    res.status(202).json(await service.deleteAccount(user(req)))
  })
  app.use((err, _req, res, _next) => {
    if (err instanceof z.ZodError)
      return res.status(400).json({ error: 'INVALID_INPUT' })
    const status =
      err.status || (['22P02', '22007', '22008'].includes(err.code) ? 400 : 500)
    if (status >= 500) console.error('api_error', err.code || err.name) // Never log payloads, tokens or HTML.
    res
      .status(status)
      .json({
        error:
          err instanceof Fault
            ? err.code
            : status === 413
              ? 'HTML_TOO_LARGE'
              : status === 400
                ? 'INVALID_INPUT'
                : 'SERVICE_UNAVAILABLE',
      })
  })
  return app
}

import { database } from './db.mjs'
import { storage } from './storage.mjs'
import { authenticator } from './auth.mjs'
import { createApp } from './app.mjs'
import { config } from './config.mjs'
const settings = config(),
  db = database(process.env.DATABASE_URL)
const app = createApp({
  db,
  store: storage(process.env),
  authenticate: authenticator(
    process.env.CLERK_ISSUER_URL,
    undefined,
    (process.env.CLERK_AUTHORIZED_PARTIES || '')
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean),
  ),
  config: settings,
})
const server = app.listen(Number(process.env.PORT || 4320), '0.0.0.0', () =>
  console.log('Recipe cloud API ready'),
)
for (const signal of ['SIGINT', 'SIGTERM'])
  process.on(signal, () =>
    server.close(async () => {
      await db.close()
      process.exit(0)
    }),
  )

import { setTimeout } from 'node:timers/promises'
import { createClient } from '@supabase/supabase-js'
import { database } from './db.mjs'
import { storage } from './storage.mjs'
import { extractor } from './extractor.mjs'
import { processOne, cleanupOne } from './jobs.mjs'
import { config } from './config.mjs'
config(process.env, { worker: true })
const db = database(process.env.DATABASE_URL),
  store = storage(process.env),
  extract = extractor(process.env)
const auth = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SECRET_KEY,
  { auth: { persistSession: false, autoRefreshToken: false } },
)
let stopping = false
for (const s of ['SIGTERM', 'SIGINT'])
  process.on(s, () => {
    stopping = true
  })
while (!stopping) {
  try {
    await cleanupOne(db, store, async (id) => {
      const { error } = await auth.auth.admin.deleteUser(id)
      if (error && error.status !== 404) throw new Error('AUTH_DELETE_FAILED')
    })
    if (!(await processOne(db, store, extract))) await setTimeout(2000)
  } catch (e) {
    console.error('worker_error', e.code || e.name)
    await setTimeout(5000)
  }
}
await db.close()

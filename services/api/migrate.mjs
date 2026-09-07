import { readFile } from 'node:fs/promises'
import { database } from './db.mjs'
if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL required')
const db = database(process.env.DATABASE_URL)
const sql = await readFile(new URL('./schema.sql', import.meta.url), 'utf8')
try {
  await db.transaction((c) => c.query(sql))
  console.log('Schema ready')
} finally {
  await db.close()
}

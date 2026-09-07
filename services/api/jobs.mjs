import { randomUUID } from 'node:crypto'
import { member } from './domain.mjs'

export async function claimJob(db) {
  return db.transaction(async (c) => {
    const job = (
      await c.query(`SELECT * FROM jobs WHERE status='queued' OR (status='processing' AND lease_until<now())
      ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 1`)
    ).rows[0]
    if (!job) return null
    return (
      await c.query(
        `UPDATE jobs SET status='processing',attempts=attempts+1,lease_token=$2,
      lease_until=now()+interval '3 minutes',updated_at=now() WHERE id=$1 RETURNING *`,
        [job.id, randomUUID()],
      )
    ).rows[0]
  })
}
export async function finishJob(db, job, result, errorCode = null) {
  return db.transaction(async (c) => {
    const actor = (
      await c.query('SELECT * FROM users WHERE id=$1 FOR UPDATE', [job.user_id])
    ).rows[0]
    let allowed = actor && !actor.deleted_at
    if (allowed) {
      try {
        await member(c, job.user_id, job.book_id, ['owner', 'editor'])
      } catch (e) {
        if (e.code === 'BOOK_ACCESS_DENIED') allowed = false
        else throw e
      }
    }
    const fresh = (
      await c.query('SELECT * FROM jobs WHERE id=$1 FOR UPDATE', [job.id])
    ).rows[0]
    if (
      !fresh ||
      fresh.status !== 'processing' ||
      fresh.lease_token !== job.lease_token
    )
      return { stale: true }
    const status = !allowed
      ? 'failed'
      : errorCode
        ? 'failed'
        : result?.card
          ? 'succeeded'
          : 'needs_review'
    if (status === 'succeeded') {
      const archive = (
        await c.query('SELECT source_url FROM archives WHERE id=$1', [
          job.archive_id,
        ])
      ).rows[0]
      await c.query(
        `INSERT INTO recipes(id,book_id,archive_id,card,image_key,image_content_type) VALUES($1,$2,$3,$4,$5,$6)`,
        [
          randomUUID(),
          job.book_id,
          job.archive_id,
          JSON.stringify({
            ...result.card,
            sourceUrl: archive.source_url,
            memo: '',
          }),
          result.imageKey || null,
          result.imageContentType || null,
        ],
      )
      await c.query(
        'INSERT INTO ledger(id,user_id,delta,reason,reference) VALUES($1,$2,-1,$3,$4)',
        [randomUUID(), job.user_id, 'IMPORT', `import:${job.id}`],
      )
    }
    await c.query(
      'UPDATE wallets SET reserved=reserved-1,balance=balance-$2 WHERE user_id=$1',
      [job.user_id, status === 'succeeded' ? 1 : 0],
    )
    await c.query(
      `UPDATE jobs SET status=$2,error_code=$3,lease_token=NULL,lease_until=NULL,updated_at=now(),model=$4,usage=$5 WHERE id=$1`,
      [
        job.id,
        status,
        !allowed
          ? 'BOOK_ACCESS_REVOKED'
          : errorCode ||
            (status === 'needs_review' ? 'SOURCE_REVIEW_REQUIRED' : null),
        result?.model || null,
        result?.usage ? JSON.stringify(result.usage) : null,
      ],
    )
    return { status }
  })
}
export async function processOne(db, store, extract) {
  const job = await claimJob(db)
  if (!job) return false
  let result = null,
    error = null
  try {
    if (job.attempts > 3) throw new Error('RETRY_LIMIT')
    const valid = await db.transaction(async (c) => {
      const user = (
        await c.query('SELECT deleted_at FROM users WHERE id=$1', [job.user_id])
      ).rows[0]
      if (!user || user.deleted_at) return false
      try {
        await member(c, job.user_id, job.book_id, ['owner', 'editor'])
        return true
      } catch {
        return false
      }
    })
    if (!valid) throw new Error('BOOK_ACCESS_REVOKED')
    const fullArchive = (
      await db.query(
        'SELECT object_key,image_key,image_content_type FROM archives WHERE id=$1',
        [job.archive_id],
      )
    ).rows[0]
    result = await extract(await store.get(fullArchive.object_key))
    if (result.card && fullArchive.image_key) {
      const imageKey = `books/${job.book_id}/recipes/${job.id}.image`
      await store.copy(
        fullArchive.image_key,
        imageKey,
        fullArchive.image_content_type,
      )
      result.imageKey = imageKey
      result.imageContentType = fullArchive.image_content_type
    }
  } catch (e) {
    error = [
      'RETRY_LIMIT',
      'BOOK_ACCESS_REVOKED',
      'SOURCE_TOO_LARGE_FOR_MODEL',
    ].includes(e.message)
      ? e.message
      : 'IMPORT_FAILED'
  }
  await finishJob(db, job, result, error)
  return true
}

export async function cleanupOne(db, store, deleteAuth) {
  const user = (
    await db.query(
      'SELECT id FROM users WHERE deleted_at IS NOT NULL AND deletion_completed_at IS NULL ORDER BY deleted_at LIMIT 1',
    )
  ).rows[0]
  if (!user) return false
  const emptyBooks = (
    await db.query(
      `SELECT id FROM books WHERE NOT EXISTS(
        SELECT 1 FROM members WHERE members.book_id=books.id
      )`,
    )
  ).rows
  await store.deleteUser(user.id)
  for (const book of emptyBooks)
    await store.deletePrefix(`books/${book.id}/`)
  await deleteAuth(user.id)
  await db.transaction(async (c) => {
    await c.query('SELECT id FROM users WHERE id=$1 FOR UPDATE', [user.id])
    await c.query('DELETE FROM archives WHERE user_id=$1', [user.id])
    // Detached archives can belong to former members. Keep their personal originals and
    // pending jobs until they are settled; never cascade away somebody else's reservation.
    await c.query(
      `DELETE FROM recipes WHERE book_id IN (SELECT id FROM books WHERE NOT EXISTS(SELECT 1 FROM members WHERE members.book_id=books.id))`,
    )
    await c.query(
      `DELETE FROM plans WHERE book_id IN (SELECT id FROM books WHERE NOT EXISTS(SELECT 1 FROM members WHERE members.book_id=books.id))`,
    )
    await c.query(
      `DELETE FROM invites WHERE book_id IN (SELECT id FROM books WHERE NOT EXISTS(SELECT 1 FROM members WHERE members.book_id=books.id))`,
    )
    await c.query(`DELETE FROM books WHERE NOT EXISTS(SELECT 1 FROM members WHERE members.book_id=books.id)
      AND NOT EXISTS(SELECT 1 FROM archives WHERE archives.book_id=books.id)`)
    await c.query('UPDATE users SET deletion_completed_at=now() WHERE id=$1', [
      user.id,
    ])
  })
  return true
}

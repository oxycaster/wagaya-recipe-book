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
    const consumed =
      status === 'succeeded'
        ? Math.max(1, Math.min(fresh.reserved_credits, result.creditsUsed || 1))
        : 0
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
        'INSERT INTO ledger(id,user_id,delta,reason,reference) VALUES($1,$2,$3,$4,$5)',
        [randomUUID(), job.user_id, -consumed, 'IMPORT', `import:${job.id}`],
      )
    }
    await c.query(
      'UPDATE wallets SET reserved=reserved-$2,balance=balance-$3 WHERE user_id=$1',
      [job.user_id, fresh.reserved_credits, consumed],
    )
    await c.query(
      `UPDATE jobs SET status=$2,error_code=$3,lease_token=NULL,lease_until=NULL,
       updated_at=now(),model=$4,usage=$5,consumed_credits=$6,phase=$7 WHERE id=$1`,
      [
        job.id,
        status,
        !allowed
          ? 'BOOK_ACCESS_REVOKED'
          : errorCode ||
            (status === 'needs_review' ? 'SOURCE_REVIEW_REQUIRED' : null),
        result?.model || null,
        result?.usage ? JSON.stringify(result.usage) : null,
        consumed,
        status,
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
    const checkpoint = {
      load: async (phase, chunkIndex, chunkHash) =>
        (
          await db.query(
            `SELECT result,usage,model FROM job_model_calls
             WHERE job_id=$1 AND phase=$2 AND chunk_index=$3 AND chunk_hash=$4 AND status='completed'`,
            [job.id, phase, chunkIndex, chunkHash],
          )
        ).rows[0],
      save: async (phase, chunkIndex, chunkHash, value) => {
        await db.query(
          `INSERT INTO job_model_calls(id,job_id,phase,chunk_index,chunk_hash,model,status,result,usage)
           VALUES($1,$2,$3,$4,$5,$6,'completed',$7,$8) ON CONFLICT DO NOTHING`,
          [
            randomUUID(), job.id, phase, chunkIndex, chunkHash, value.model,
            JSON.stringify(value.result), JSON.stringify(value.usage),
          ],
        )
      },
      progress: async (phase, processed, total) => {
        const updated = await db.query(
          `UPDATE jobs SET phase=$3,processed_chunks=$4,total_chunks=$5,
           lease_until=now()+interval '3 minutes',updated_at=now()
           WHERE id=$1 AND lease_token=$2 RETURNING id`,
          [job.id, job.lease_token, phase, processed, total],
        )
        if (!updated.rows.length) throw new Error('STALE_LEASE')
      },
    }
    result = await extract(await store.get(fullArchive.object_key), checkpoint)
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
      'STALE_LEASE',
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

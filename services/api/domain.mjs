import { randomUUID, randomBytes, createHash } from 'node:crypto'
import { z } from 'zod'

export class Fault extends Error {
  constructor(status, code) {
    super(code)
    this.status = status
    this.code = code
  }
}
export const requireThat = (ok, status, code) => {
  if (!ok) throw new Fault(status, code)
}
export const hash = (value) => createHash('sha256').update(value).digest('hex')
export const uuid = z.uuid()
export const cardSchema = z
  .object({
    title: z.string().trim().min(1).max(300),
    category: z.enum(['主菜', '副菜', '汁物', 'その他']),
    minutes: z.number().int().min(0).max(10080).nullable(),
    servings: z.number().positive().max(1000).nullable(),
    ingredients: z
      .array(
        z
          .object({
            name: z.string().min(1).max(300),
            amount: z.string().max(300),
          })
          .strict(),
      )
      .min(1)
      .max(200),
    steps: z.array(z.string().min(1).max(4000)).min(1).max(100),
    tags: z.array(z.string().max(50)).max(20),
  })
  .strict()
const roles = ['owner', 'editor', 'viewer']
export async function member(c, user, book, allowed = roles) {
  await c.query('SELECT id FROM books WHERE id=$1 FOR UPDATE', [book])
  const { rows } = await c.query(
    'SELECT role FROM members WHERE book_id=$1 AND user_id=$2',
    [book, user],
  )
  requireThat(
    rows[0] && allowed.includes(rows[0].role),
    403,
    'BOOK_ACCESS_DENIED',
  )
  return rows[0].role
}

export function domain(db) {
  const run = (user, fn) =>
    db.transaction(async (c) => {
      const { rows } = await c.query(
        'SELECT * FROM users WHERE id=$1 FOR UPDATE',
        [user],
      )
      requireThat(rows[0] && !rows[0].deleted_at, 403, 'ACCOUNT_DISABLED')
      return fn(c, rows[0])
    })
  return {
    run,
    async identity(id, email) {
      uuid.parse(id)
      return db.transaction(async (c) => {
        const { rows } = await c.query(
          `INSERT INTO users(id,email) VALUES($1,$2)
          ON CONFLICT(id) DO UPDATE SET email=EXCLUDED.email WHERE users.deleted_at IS NULL RETURNING id`,
          [id, email.toLowerCase()],
        )
        requireThat(rows.length, 403, 'ACCOUNT_DISABLED')
        await c.query(
          'INSERT INTO wallets(user_id) VALUES($1) ON CONFLICT DO NOTHING',
          [id],
        )
      })
    },
    books: (user) =>
      run(
        user,
        async (c) =>
          (
            await c.query(
              'SELECT b.*,m.role FROM books b JOIN members m ON m.book_id=b.id WHERE m.user_id=$1 ORDER BY b.created_at',
              [user],
            )
          ).rows,
      ),
    createBook: (user, name) =>
      run(user, async (c) => {
        name = z.string().trim().min(1).max(100).parse(name)
        const count = await c.query(
          'SELECT count(*)::int AS n FROM members WHERE user_id=$1',
          [user],
        )
        requireThat(count.rows[0].n < 30, 429, 'BOOK_LIMIT')
        const id = randomUUID()
        await c.query('INSERT INTO books(id,name) VALUES($1,$2)', [id, name])
        await c.query("INSERT INTO members VALUES($1,$2,'owner')", [id, user])
        return { id, name, role: 'owner' }
      }),
    renameBook: (user, book, name) =>
      run(user, async (c) => {
        await member(c, user, book, ['owner'])
        name = z.string().trim().min(1).max(100).parse(name)
        return (
          await c.query(
            'UPDATE books SET name=$2 WHERE id=$1 RETURNING id,name',
            [book, name],
          )
        ).rows[0]
      }),
    invite: (user, book, input) =>
      run(user, async (c) => {
        await member(c, user, book, ['owner'])
        const data = z
          .object({ email: z.email(), role: z.enum(['editor', 'viewer']) })
          .parse(input)
        const token = randomBytes(32).toString('hex'),
          id = randomUUID()
        await c.query(
          `INSERT INTO invites(id,book_id,token_hash,email,role,expires_at)
        VALUES($1,$2,$3,$4,$5,now()+interval '7 days')`,
          [id, book, hash(token), data.email.toLowerCase(), data.role],
        )
        return { id, token, url: `wagayarecipe://invite?token=${token}` }
      }),
    acceptInvite: (user, token) =>
      run(user, async (c, actor) => {
        z.string()
          .regex(/^[a-f0-9]{64}$/)
          .parse(token)
        const found = (
          await c.query('SELECT book_id FROM invites WHERE token_hash=$1', [
            hash(token),
          ])
        ).rows[0]
        requireThat(found, 404, 'INVITE_UNAVAILABLE')
        await c.query('SELECT id FROM books WHERE id=$1 FOR UPDATE', [
          found.book_id,
        ])
        const inv = (
          await c.query(
            'SELECT * FROM invites WHERE token_hash=$1 FOR UPDATE',
            [hash(token)],
          )
        ).rows[0]
        requireThat(
          inv &&
            !inv.revoked &&
            +new Date(inv.expires_at) > Date.now() &&
            inv.email === actor.email &&
            (!inv.accepted_by || inv.accepted_by === user),
          403,
          'INVITE_UNAVAILABLE',
        )
        if (!inv.accepted_by) {
          await c.query(
            'INSERT INTO members VALUES($1,$2,$3) ON CONFLICT DO NOTHING',
            [inv.book_id, user, inv.role],
          )
          await c.query('UPDATE invites SET accepted_by=$1 WHERE id=$2', [
            user,
            inv.id,
          ])
        }
        return { bookId: inv.book_id }
      }),
    family: (user, book) =>
      run(user, async (c) => {
        await member(c, user, book, ['owner'])
        return {
          members: (
            await c.query(
              'SELECT m.user_id,m.role,u.email FROM members m JOIN users u ON u.id=m.user_id WHERE book_id=$1',
              [book],
            )
          ).rows,
          invites: (
            await c.query(
              'SELECT id,email,role,expires_at,accepted_by,revoked FROM invites WHERE book_id=$1',
              [book],
            )
          ).rows,
        }
      }),
    revokeInvite: (user, book, id) =>
      run(user, async (c) => {
        await member(c, user, book, ['owner'])
        await c.query(
          'UPDATE invites SET revoked=true WHERE book_id=$1 AND id=$2',
          [book, id],
        )
      }),
    changeMember: (user, book, target, role) =>
      run(user, async (c) => {
        await member(c, user, book, ['owner'])
        requireThat(user !== target, 400, 'USE_OWNERSHIP_TRANSFER')
        if (role === null) {
          // Pending work is re-authorized by the worker and refunded when access is gone.
          await c.query('DELETE FROM members WHERE book_id=$1 AND user_id=$2', [
            book,
            target,
          ])
        } else {
          z.enum(['editor', 'viewer']).parse(role)
          await c.query(
            'UPDATE members SET role=$3 WHERE book_id=$1 AND user_id=$2',
            [book, target, role],
          )
        }
      }),
    transfer: (user, book, target) =>
      run(user, async (c) => {
        const targetUser = (
          await c.query('SELECT deleted_at FROM users WHERE id=$1 FOR UPDATE', [
            target,
          ])
        ).rows[0]
        requireThat(
          targetUser && !targetUser.deleted_at,
          404,
          'MEMBER_NOT_FOUND',
        )
        await member(c, user, book, ['owner'])
        requireThat(user !== target, 400, 'INVALID_TRANSFER')
        const exists = await c.query(
          'SELECT 1 FROM members WHERE book_id=$1 AND user_id=$2',
          [book, target],
        )
        requireThat(exists.rows.length, 404, 'MEMBER_NOT_FOUND')
        await c.query(
          "UPDATE members SET role='editor' WHERE book_id=$1 AND user_id=$2",
          [book, user],
        )
        await c.query(
          "UPDATE members SET role='owner' WHERE book_id=$1 AND user_id=$2",
          [book, target],
        )
      }),
    addArchive: (user, book, archive, persist = async () => {}) =>
      run(user, async (c) => {
        await member(c, user, book, ['owner', 'editor'])
        const n = (
          await c.query(
            'SELECT count(*)::int AS n FROM archives WHERE user_id=$1',
            [user],
          )
        ).rows[0].n
        requireThat(n < 1000, 429, 'ARCHIVE_LIMIT')
        const old = (
          await c.query(
            'SELECT * FROM archives WHERE user_id=$1 AND book_id=$2 AND sha256=$3',
            [user, book, archive.sha256],
          )
        ).rows[0]
        if (old) return old
        await persist()
        return (
          await c.query(
            `INSERT INTO archives(id,user_id,book_id,object_key,image_key,image_content_type,source_url,sha256)
             VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
            [
              archive.id,
              user,
              book,
              archive.object_key,
              archive.image_key || null,
              archive.image_content_type || null,
              archive.source_url,
              archive.sha256,
            ],
          )
        ).rows[0]
      }),
    archives: (user, book) =>
      run(user, async (c) => {
        await member(c, user, book)
        return (
          await c.query(
            `SELECT a.id,a.source_url,a.created_at,j.status,j.error_code,j.id AS job_id FROM archives a
        LEFT JOIN LATERAL (SELECT * FROM jobs WHERE archive_id=a.id ORDER BY created_at DESC LIMIT 1) j ON true
        WHERE a.user_id=$1 AND a.book_id=$2 ORDER BY a.created_at DESC`,
            [user, book],
          )
        ).rows
      }),
    archive: (user, id) =>
      run(user, async (c) => {
        const a = (
          await c.query('SELECT * FROM archives WHERE id=$1 AND user_id=$2', [
            id,
            user,
          ])
        ).rows[0]
        requireThat(a, 404, 'ARCHIVE_NOT_FOUND')
        return a
      }),
    enqueue: (user, book, archive, key) =>
      run(user, async (c) => {
        await member(c, user, book, ['owner', 'editor'])
        const a = (
          await c.query(
            'SELECT * FROM archives WHERE id=$1 AND user_id=$2 AND book_id=$3',
            [archive, user, book],
          )
        ).rows[0]
        requireThat(a, 404, 'ARCHIVE_NOT_FOUND')
        const previous = (
          await c.query(
            'SELECT * FROM jobs WHERE user_id=$1 AND request_key=$2',
            [user, key],
          )
        ).rows[0]
        if (previous) {
          requireThat(
            previous.archive_id === archive && previous.book_id === book,
            409,
            'IDEMPOTENCY_CONFLICT',
          )
          return previous
        }
        const active = (
          await c.query(
            "SELECT * FROM jobs WHERE archive_id=$1 AND status IN ('queued','processing','succeeded')",
            [archive],
          )
        ).rows[0]
        if (active) return active
        const wallet = (
          await c.query('SELECT * FROM wallets WHERE user_id=$1 FOR UPDATE', [
            user,
          ])
        ).rows[0]
        requireThat(
          wallet.balance - wallet.reserved >= 1,
          402,
          'INSUFFICIENT_CREDITS',
        )
        requireThat(wallet.reserved < 5, 429, 'TOO_MANY_IMPORTS')
        const recent = (
          await c.query(
            "SELECT count(*)::int AS n FROM jobs WHERE user_id=$1 AND created_at>now()-interval '1 day'",
            [user],
          )
        ).rows[0].n
        requireThat(recent < 100, 429, 'DAILY_IMPORT_LIMIT')
        await c.query(
          'UPDATE wallets SET reserved=reserved+1 WHERE user_id=$1',
          [user],
        )
        return (
          await c.query(
            "INSERT INTO jobs(id,user_id,book_id,archive_id,request_key,status) VALUES($1,$2,$3,$4,$5,'queued') RETURNING *",
            [randomUUID(), user, book, archive, key],
          )
        ).rows[0]
      }),
    wallet: (user) =>
      run(user, async (c) => {
        const w = (
          await c.query(
            'SELECT balance,reserved,balance-reserved AS available FROM wallets WHERE user_id=$1',
            [user],
          )
        ).rows[0]
        return {
          ...w,
          ledger: (
            await c.query(
              'SELECT delta,reason,created_at FROM ledger WHERE user_id=$1 ORDER BY created_at DESC LIMIT 50',
              [user],
            )
          ).rows,
        }
      }),
    recipes: (user, book) =>
      run(user, async (c) => {
        await member(c, user, book)
        return (
          await c.query(
            'SELECT id,card,version,created_at,image_key IS NOT NULL AS has_image FROM recipes WHERE book_id=$1 ORDER BY created_at DESC',
            [book],
          )
        ).rows
      }),
    updateRecipe: (user, book, id, input) =>
      run(user, async (c) => {
        await member(c, user, book, ['owner', 'editor'])
        const data = z
          .object({
            version: z.number().int().positive(),
            card: cardSchema,
            memo: z.string().max(10000),
          })
          .parse(input)
        const result = await c.query(
          `UPDATE recipes SET card=card || $4::jsonb,version=version+1 WHERE book_id=$1 AND id=$2 AND version=$3 RETURNING *`,
          [
            book,
            id,
            data.version,
            JSON.stringify({ ...data.card, memo: data.memo }),
          ],
        )
        requireThat(result.rows.length, 409, 'EDIT_CONFLICT')
        return result.rows[0]
      }),
    recipeImage: (user, id) =>
      run(user, async (c) => {
        const image = (
          await c.query(
            `SELECT r.image_key,r.image_content_type FROM recipes r
             JOIN members m ON m.book_id=r.book_id
             WHERE r.id=$1 AND m.user_id=$2`,
            [id, user],
          )
        ).rows[0]
        requireThat(image?.image_key, 404, 'IMAGE_NOT_FOUND')
        return image
      }),
    plan: (user, book, day) =>
      run(user, async (c) => {
        await member(c, user, book)
        return (
          (
            await c.query(
              'SELECT items,version FROM plans WHERE book_id=$1 AND day=$2',
              [book, day],
            )
          ).rows[0] || { items: [], version: 0 }
        )
      }),
    savePlan: (user, book, day, input) =>
      run(user, async (c) => {
        await member(c, user, book, ['owner', 'editor'])
        const data = z
          .object({
            version: z.number().int().nonnegative(),
            items: z
              .array(
                z
                  .object({
                    id: uuid,
                    recipeId: uuid,
                    state: z.enum(['cook', 'leftover']),
                    portions: z.number().positive().max(100),
                  })
                  .strict(),
              )
              .max(50),
          })
          .parse(input)
        const ids = [...new Set(data.items.map((i) => i.recipeId))]
        if (ids.length)
          requireThat(
            (
              await c.query(
                'SELECT id FROM recipes WHERE book_id=$1 AND id=ANY($2::uuid[])',
                [book, ids],
              )
            ).rows.length === ids.length,
            400,
            'INVALID_RECIPE',
          )
        const previous = (
          await c.query(
            'SELECT version FROM plans WHERE book_id=$1 AND day=$2',
            [book, day],
          )
        ).rows[0]
        requireThat(
          (previous?.version || 0) === data.version,
          409,
          'EDIT_CONFLICT',
        )
        return (
          await c.query(
            `INSERT INTO plans(book_id,day,items) VALUES($1,$2,$3) ON CONFLICT(book_id,day) DO UPDATE SET items=EXCLUDED.items,version=plans.version+1 RETURNING items,version`,
            [book, day, JSON.stringify(data.items)],
          )
        ).rows[0]
      }),
    deleteAccount: (user) =>
      run(user, async (c) => {
        const owned = (
          await c.query(
            "SELECT book_id FROM members WHERE user_id=$1 AND role='owner' ORDER BY book_id",
            [user],
          )
        ).rows
        for (const { book_id } of owned) {
          await member(c, user, book_id, ['owner'])
          const others = (
            await c.query(
              'SELECT 1 FROM members WHERE book_id=$1 AND user_id<>$2',
              [book_id, user],
            )
          ).rows
          requireThat(!others.length, 409, 'TRANSFER_OWNERSHIP_FIRST')
        }
        await c.query(
          "UPDATE jobs SET status='failed',error_code='ACCOUNT_DELETED',lease_token=NULL,lease_until=NULL WHERE user_id=$1 AND status IN ('queued','processing')",
          [user],
        )
        await c.query('UPDATE wallets SET reserved=0 WHERE user_id=$1', [user])
        const actor = (
          await c.query('SELECT email FROM users WHERE id=$1', [user])
        ).rows[0]
        await c.query('DELETE FROM invites WHERE email=$1 OR accepted_by=$2', [
          actor.email,
          user,
        ])
        // Preserve shared cards but detach originals in cleanup. Remove private books only after S3 cleanup.
        await c.query(
          'UPDATE users SET deleted_at=now(),email=$2 WHERE id=$1',
          [user, `deleted:${user}`],
        )
        await c.query('DELETE FROM members WHERE user_id=$1', [user])
        return { status: 'deletion_pending' }
      }),
  }
}

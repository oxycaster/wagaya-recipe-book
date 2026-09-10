import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { requireThat } from './domain.mjs'

export async function billingEvent(db, event, config) {
  if (
    !['NON_RENEWING_PURCHASE', 'CANCELLATION', 'REFUND_REVERSED'].includes(
      event?.type,
    )
  )
    return { ignored: true }
  const e = z
    .object({
      id: z.string().min(1).max(200),
      type: z.string(),
      app_id: z.string(),
      store: z.literal('APP_STORE'),
      environment: z.enum(['PRODUCTION', 'SANDBOX']),
      app_user_id: z.string().min(1).max(200).regex(/^[A-Za-z0-9_-]+$/),
      product_id: z.string(),
      transaction_id: z.string().min(1).max(200),
      event_timestamp_ms: z.number().int().positive(),
      is_family_share: z.boolean().optional(),
    })
    .parse(event)
  requireThat(
    e.app_id === config.appId &&
      config.environments.includes(e.environment) &&
      !e.is_family_share,
    400,
    'BILLING_APP_MISMATCH',
  )
  const credits = config.products[e.product_id]
  requireThat(
    Number.isSafeInteger(credits) && credits > 0 && credits <= 10000,
    400,
    'UNKNOWN_PRODUCT',
  )
  return db.transaction(async (c) => {
    const user = (
      await c.query('SELECT * FROM users WHERE id=$1 FOR UPDATE', [
        e.app_user_id,
      ])
    ).rows[0]
    requireThat(user, 503, 'BILLING_USER_NOT_READY')
    if (
      (await c.query('SELECT 1 FROM billing_events WHERE id=$1', [e.id])).rows
        .length
    )
      return { duplicate: true }
    const keys = [e.store, e.environment, e.transaction_id]
    await c.query(
      `INSERT INTO purchases(store,environment,transaction_id,user_id,product_id,credits) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING`,
      [...keys, e.app_user_id, e.product_id, credits],
    )
    const p = (
      await c.query(
        'SELECT * FROM purchases WHERE store=$1 AND environment=$2 AND transaction_id=$3 FOR UPDATE',
        keys,
      )
    ).rows[0]
    requireThat(
      p.user_id === e.app_user_id && p.product_id === e.product_id,
      409,
      'TRANSACTION_OWNER_MISMATCH',
    )
    let delta = 0
    if (e.type === 'NON_RENEWING_PURCHASE' && !p.granted) {
      p.granted = true
      delta = p.refunded ? 0 : p.credits
    } else if (
      e.type !== 'NON_RENEWING_PURCHASE' &&
      e.event_timestamp_ms > Number(p.refund_at)
    ) {
      const refunded = e.type === 'CANCELLATION'
      if (p.refunded !== refunded && p.granted)
        delta = refunded ? -p.credits : p.credits
      p.refunded = refunded
      p.refund_at = e.event_timestamp_ms
    }
    await c.query(
      'UPDATE purchases SET granted=$4,refunded=$5,refund_at=$6 WHERE store=$1 AND environment=$2 AND transaction_id=$3',
      [...keys, p.granted, p.refunded, p.refund_at],
    )
    if (delta) {
      await c.query('UPDATE wallets SET balance=balance+$2 WHERE user_id=$1', [
        e.app_user_id,
        delta,
      ])
      await c.query(
        'INSERT INTO ledger(id,user_id,delta,reason,reference) VALUES($1,$2,$3,$4,$5)',
        [randomUUID(), e.app_user_id, delta, e.type, `billing:${e.id}`],
      )
    }
    await c.query('INSERT INTO billing_events(id,type) VALUES($1,$2)', [
      e.id,
      e.type,
    ])
    return { accepted: true }
  })
}

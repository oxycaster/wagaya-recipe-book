import 'react-native-url-polyfill/auto'
import * as SecureStore from 'expo-secure-store'
import * as Crypto from 'expo-crypto'
import { createClient } from '@supabase/supabase-js'
import Purchases, { PRODUCT_CATEGORY } from 'react-native-purchases'

export const settings = {
  api: process.env.EXPO_PUBLIC_API_URL || '',
  supabase: process.env.EXPO_PUBLIC_SUPABASE_URL || '',
  publishable: process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY || '',
  revenuecat: process.env.EXPO_PUBLIC_REVENUECAT_IOS_KEY || '',
  privacy: process.env.EXPO_PUBLIC_PRIVACY_URL || '',
  terms: process.env.EXPO_PUBLIC_TERMS_URL || '',
}
export const configured = Boolean(
  settings.api && settings.supabase && settings.publishable,
)
// Split sessions to stay under native secure-storage value limits. Publish the pointer last.
const secureOperations = {
  async getItem(key: string) {
    const pointer = await SecureStore.getItemAsync(key)
    if (!pointer) return null
    const { generation, count } = JSON.parse(pointer) as {
      generation: string
      count: number
    }
    const parts = await Promise.all(
      Array.from({ length: count }, (_, i) =>
        SecureStore.getItemAsync(`${key}.${generation}.${i}`),
      ),
    )
    return parts.some((p) => p === null) ? null : parts.join('')
  },
  async setItem(key: string, value: string) {
    const previous = await SecureStore.getItemAsync(key),
      generation = Crypto.randomUUID(),
      points = Array.from(value),
      count = Math.ceil(points.length / 400)
    for (let i = 0; i < count; i++)
      await SecureStore.setItemAsync(
        `${key}.${generation}.${i}`,
        points.slice(i * 400, (i + 1) * 400).join(''),
      )
    await SecureStore.setItemAsync(key, JSON.stringify({ generation, count }))
    if (previous) {
      const old = JSON.parse(previous)
      for (let i = 0; i < old.count; i++)
        await SecureStore.deleteItemAsync(`${key}.${old.generation}.${i}`)
    }
  },
  async removeItem(key: string) {
    const previous = await SecureStore.getItemAsync(key)
    await SecureStore.deleteItemAsync(key)
    if (previous) {
      const old = JSON.parse(previous)
      for (let i = 0; i < old.count; i++)
        await SecureStore.deleteItemAsync(`${key}.${old.generation}.${i}`)
    }
  },
}
// Serialize reads with writes so a refresh cannot remove chunks being read by getSession.
let storageQueue: Promise<unknown> = Promise.resolve()
function storageTask<T>(fn: () => Promise<T>): Promise<T> {
  const next = storageQueue.then(fn, fn)
  storageQueue = next.then(
    () => undefined,
    () => undefined,
  )
  return next
}
const secureStorage = {
  getItem: (key: string) => storageTask(() => secureOperations.getItem(key)),
  setItem: (key: string, value: string) =>
    storageTask(() => secureOperations.setItem(key, value)),
  removeItem: (key: string) =>
    storageTask(() => secureOperations.removeItem(key)),
}
export const supabase = createClient(
  settings.supabase || 'https://unconfigured.invalid',
  settings.publishable || 'unconfigured',
  {
    auth: {
      storage: secureStorage,
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: false,
    },
  },
)
const messages: Record<string, string> = {
  INSUFFICIENT_CREDITS: '取り込み権が不足しています。「設定」で購入できます。',
  BOOK_ACCESS_DENIED: 'このレシピ帖の操作権限がありません。',
  EDIT_CONFLICT:
    '家族が先に更新しました。最新の内容を読み直してから編集してください。',
  INVALID_INPUT: '入力内容を確認してください。',
  TRANSFER_OWNERSHIP_FIRST:
    '共有中のレシピ帖があります。家族画面で所有者を移してから削除してください。',
  INVITE_UNAVAILABLE:
    '招待が無効・期限切れ、または招待先のメールアドレスと異なります。',
  SIGN_IN_REQUIRED: 'もう一度ログインしてください。',
  INVALID_SESSION:
    'ログインの有効期限が切れました。もう一度ログインしてください。',
  PRIVATE_URL_DENIED: '公開されているウェブページのURLを指定してください。',
  HTML_UNAVAILABLE:
    'ページを取得できませんでした。ブラウザで保存したHTMLファイルも選べます。',
  HTML_TOO_LARGE: 'HTMLは2MB以下にしてください。',
  ACCOUNT_DISABLED: 'このアカウントは削除手続き中です。',
  TOO_MANY_IMPORTS: '取り込みが終わるまでお待ちください。',
  DAILY_IMPORT_LIMIT:
    '本日の取り込み上限に達しました。明日もう一度お試しください。',
}
export async function api<T>(
  path: string,
  method = 'GET',
  body?: unknown,
): Promise<T> {
  const { data } = await supabase.auth.getSession()
  if (!data.session) throw new Error('ログインしてください。')
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 35000)
  try {
    const response = await fetch(
      `${settings.api.replace(/\/$/, '')}/v1${path}`,
      {
        method,
        headers: {
          Authorization: `Bearer ${data.session.access_token}`,
          'Content-Type': 'application/json',
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: controller.signal,
      },
    )
    if (!response.ok) {
      const result = await response.json().catch(() => ({}))
      throw new Error(
        messages[result.error] ||
          '通信に失敗しました。時間をおいて再試行してください。',
      )
    }
    return response.status === 204 ? (undefined as T) : await response.json()
  } finally {
    clearTimeout(timer)
  }
}
let purchaseConfigured = false
export async function purchaseIdentity(userId: string) {
  if (!settings.revenuecat) throw new Error('アプリ内購入は準備中です。')
  if (!purchaseConfigured) {
    Purchases.configure({ apiKey: settings.revenuecat, appUserID: userId })
    purchaseConfigured = true
  } else if ((await Purchases.getAppUserID()) !== userId)
    await Purchases.logIn(userId)
}
export async function products(userId: string) {
  await purchaseIdentity(userId)
  const catalog = await api<{ id: string; credits: number }[]>('/products')
  const native = await Purchases.getProducts(
    catalog.map((p) => p.id),
    PRODUCT_CATEGORY.NON_SUBSCRIPTION,
  )
  return native.map((p) => ({
    product: p,
    credits: catalog.find((c) => c.id === p.identifier)!.credits,
  }))
}
export { Purchases }

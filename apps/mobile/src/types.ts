export type Book = {
  id: string
  name: string
  role: 'owner' | 'editor' | 'viewer'
}
export type Card = {
  title: string
  category: '主菜' | '副菜' | '汁物' | 'その他'
  minutes: number | null
  servings: number | null
  ingredients: { name: string; amount: string; group?: string | null }[]
  steps: string[]
  tags: string[]
  sourceUrl?: string
  memo?: string
}
export type Recipe = {
  id: string
  card: Card
  version: number
  created_at: string
  has_image: boolean
}
export type Archive = {
  id: string
  source_url: string
  created_at: string
  dismissed_at?: string | null
  status:
    | null
    | 'queued'
    | 'processing'
    | 'succeeded'
    | 'failed'
    | 'needs_review'
  error_code: string | null
  phase?: string
  processed_chunks?: number
  total_chunks?: number
  reserved_credits?: number
  consumed_credits?: number
}
export type ArchivePage = {
  items: Archive[]
  total: number
  nextCursor: string | null
}
export type ImportQuote = {
  quoteId: string
  estimatedInputTokens: number
  maximumCredits: number
  expiresAt: string
}
export type Plan = {
  version: number
  items: {
    id: string
    recipeId: string
    state: 'cook' | 'leftover'
    portions: number
  }[]
}
export type Wallet = {
  balance: number
  reserved: number
  available: number
  ledger: { delta: number; reason: string; created_at: string }[]
}
export type SharingState = {
  members: { user_id: string; email: string; role: Book['role'] }[]
  invites: {
    id: string
    email: string
    role: string
    expires_at: string
    accepted_by: string | null
    revoked: boolean
  }[]
}

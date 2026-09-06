export type Category = '主菜' | '副菜' | '汁物' | 'その他'

export interface Ingredient { name: string; amount: string }

export interface Recipe {
  id: string
  title: string
  category: Category
  minutes: number
  servings: number
  servingBaseOverride?: number
  ingredients: Ingredient[]
  steps: string[]
  image?: string
  color: string
  sourceUrl?: string
  sourceName?: string
  snapshotPath?: string
  tags: string[]
  memo?: string
  createdAt: string
  archiveId?: string
}

export type ArchiveStatus = 'pending' | 'processing' | 'imported' | 'needs_review' | 'failed'

export interface PageArchive {
  id: string
  requestedUrl: string
  finalUrl: string
  title: string
  sourceName: string
  htmlPath: string
  localUrl: string
  assetPaths: string[]
  contentSha256: string
  archivedAt: string
  status: ArchiveStatus
  recipeId?: string
  lastAttemptAt?: string
  lastError?: string
}

export type MealState = 'leftover' | 'cook'

export interface MealItem {
  id: string
  recipeId: string
  state: MealState
  portions: number
}

export interface DayPlan { date: string; items: MealItem[] }
export interface AppState { recipes: Recipe[]; plans: DayPlan[] }

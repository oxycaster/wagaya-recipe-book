import * as cheerio from 'cheerio'

const hasType = (value, expected) => {
  const types = Array.isArray(value) ? value : [value]
  return types.some((type) =>
    typeof type === 'string' &&
    (type === expected || type.endsWith(`/${expected}`) || type.endsWith(`#${expected}`)),
  )
}

const hasText = (value) => typeof value === 'string' && value.trim().length > 0
const hasIngredient = (value) =>
  hasText(value) ||
  (value &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    [value.name, value.value].some(hasText))
const hasIngredients = (value) =>
  Array.isArray(value) ? value.some(hasIngredient) : hasIngredient(value)
const hasInstruction = (value) => {
  if (hasText(value)) return true
  if (Array.isArray(value)) return value.some(hasInstruction)
  return Boolean(
    value &&
      typeof value === 'object' &&
      [value.text, value.name, value.itemListElement].some(hasInstruction),
  )
}

const isCompleteRecipe = (value) =>
  value &&
  typeof value === 'object' &&
  !Array.isArray(value) &&
  hasType(value['@type'], 'Recipe') &&
  typeof value.name === 'string' &&
  value.name.trim().length > 0 &&
  hasIngredients(value.recipeIngredient) &&
  hasInstruction(value.recipeInstructions)

const identity = (recipe) => {
  const raw = recipe['@id'] || recipe.url || recipe.mainEntityOfPage
  const value =
    raw && typeof raw === 'object' && !Array.isArray(raw) ? raw['@id'] : raw
  return typeof value === 'string'
    ? value.normalize('NFKC').replace(/\s+/g, '').toLowerCase()
    : JSON.stringify(recipe)
}

export function completeRecipeJsonLd(html) {
  const $ = cheerio.load(html)
  const recipes = []
  for (const text of $('script[type="application/ld+json"]')
    .map((_, element) => $(element).text())
    .get()) {
    let root
    try {
      root = JSON.parse(text)
    } catch {
      continue
    }
    const visit = (value) => {
      if (!value || typeof value !== 'object') return
      if (isCompleteRecipe(value)) recipes.push(value)
      for (const child of Array.isArray(value) ? value : Object.values(value))
        visit(child)
    }
    visit(root)
  }
  const groups = new Map()
  for (const recipe of recipes) {
    const key = identity(recipe)
    const serialized = JSON.stringify(recipe)
    const current = groups.get(key)
    if (!current || serialized.length > current.length) groups.set(key, serialized)
  }
  return groups.size === 1 ? [...groups.values()][0] : null
}

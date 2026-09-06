import type { Ingredient } from './types'

export function parseServings(label: string): number | null {
  const match = label.normalize('NFKC').trim().match(/^(\d+(?:\.\d+)?)\s*(?:人分|人前|人|\(?servings?\)?)$/i)
  return match && Number(match[1]) > 0 ? Number(match[1]) : null
}

export function sourceYield(html: string): string {
  const doc = new DOMParser().parseFromString(html, 'text/html')
  const yields: string[] = []
  const visit = (value: unknown) => {
    if (!value || typeof value !== 'object') return
    const object = value as Record<string, unknown>
    if ([object['@type']].flat().includes('Recipe') && object.recipeYield != null) {
      yields.push(String(object.recipeYield))
    }
    Object.values(object).forEach(visit)
  }
  doc.querySelectorAll('script[type="application/ld+json"]').forEach((script) => {
    try { visit(JSON.parse(script.textContent ?? '')) } catch { /* Non-JSON scripts are ignored. */ }
  })
  return yields.length === 1 ? yields[0] : ''
}

const number = String.raw`(?:\d+\s*(?:と|・|\s)\s*\d+/\d+|\d+/\d+|\d+(?:\.\d+)?)`
const unit = String.raw`(?:g|kg|mg|ml|cc|L|カップ|個分|個|本分|本|枚|束|袋|缶|丁|切れ|株|かけ|片|尾|匹|合|玉)`
const amountPattern = new RegExp(String.raw`^(?:各)?(?:約)?(?:(?:大さじ|小さじ)\s*)?${number}(?:\s*[～〜~–-]\s*${number})?\s*(?:${unit})?(?:強|弱|くらい)?(?:\s*[（(](?:約)?${number}\s*${unit}[）)])?$`, 'i')

export function splitIngredient(item: Ingredient): Ingredient {
  if (item.amount.trim()) return item
  // Only split at a separator before a quantity, never numbers in product names.
  const match = item.name.match(/^(.+?)[:：\s]+((?:各|約)?(?:大さじ|小さじ)?\s*[\d０-９].*|適量|適宜|少々|少し|半分)$/)
  return match ? { name: match[1].replace(/[:：]$/, ''), amount: match[2] } : item
}

function numeric(value: string): number {
  const mixed = value.match(/^(\d+)\s*(?:と|・|\s)\s*(\d+)\/(\d+)$/)
  if (mixed) return Number(mixed[1]) + Number(mixed[2]) / Number(mixed[3])
  const fraction = value.match(/^(\d+)\/(\d+)$/)
  return fraction ? Number(fraction[1]) / Number(fraction[2]) : Number(value)
}

export function scaleAmount(original: string, ratio: number): { text: string; unchanged: boolean } {
  if (ratio === 1) return { text: original, unchanged: false }
  const normalized = original.normalize('NFKC')
  // Percentages, lengths, concentrations, prose and ambiguous quantities stay intact.
  if (!Number.isFinite(ratio) || ratio <= 0 || !amountPattern.test(normalized)) return { text: original, unchanged: true }
  let valid = true
  const text = normalized.replace(new RegExp(number, 'g'), (value) => {
    const result = numeric(value) * ratio
    if (!Number.isFinite(result)) { valid = false; return value }
    return Number(result.toFixed(2)).toString()
  })
  return valid ? { text, unchanged: false } : { text: original, unchanged: true }
}

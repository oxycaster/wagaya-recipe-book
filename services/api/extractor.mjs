import * as cheerio from 'cheerio'
import { createHash } from 'node:crypto'
import { z } from 'zod'
import { cardSchema } from './domain.mjs'
import {
  creditsForUsage,
  estimateImport,
  importCostConfig,
  MAX_FINAL_INPUT_TOKENS,
  MAX_MODEL_OUTPUT_TOKENS,
  MAX_SCAN_OUTPUT_TOKENS,
  SCAN_INSTRUCTIONS,
  TARGETED_SCAN_INSTRUCTIONS,
  EXTRACTION_INSTRUCTIONS,
  countTokens,
} from './import-cost.mjs'

export { MAX_MODEL_OUTPUT_TOKENS }
const resultSchema = z.object({
  isRecipe: z.boolean(), reason: z.string().max(1000),
  evidence: z.array(z.string().min(1).max(2000)).max(10),
  recipe: cardSchema.extend({
    ingredients: z.array(z.object({
      name: z.string().min(1).max(300),
      amount: z.string().max(300),
      group: z.string().trim().min(1).max(300).nullable(),
    }).strict()).min(1).max(200),
  }).strict().nullable(),
}).strict()
const scanSchema = z.object({
  classification: z.enum(['none', 'single', 'multiple', 'uncertain']),
  candidateId: z.string().max(100).nullable(),
  evidence: z.array(z.string().min(1).max(500)).max(5),
  needsPrevious: z.boolean(), needsNext: z.boolean(),
}).strict()

export function prepareHtml(html) {
  const $ = cheerio.load(html)
  const structured = $('script[type="application/ld+json"]')
    .map((_, el) => $(el).text()).get().join('\n')
  return { input: html, plain: $.text().replace(/\s+/g, ' ').trim(), structured, original: html }
}

export function validateExtraction(value, source) {
  const result = resultSchema.parse(value)
  if (!result.isRecipe || !result.recipe || !result.evidence.length) return null
  const normalize = (s) => s.normalize('NFKC').replace(/\s+/g, '')
  const haystack = normalize(source.original + ' ' + source.plain + ' ' + source.structured)
  const coverage = (claim) => {
    const normalized = normalize(claim)
    if (haystack.includes(normalized)) return 1
    if (normalized.length < 8) return 0
    let matches = 0
    const total = normalized.length - 3
    for (let index = 0; index < total; index++)
      if (haystack.includes(normalized.slice(index, index + 4))) matches++
    return matches / total
  }
  const evidenceCoverage = result.evidence.map(coverage)
  if (
    evidenceCoverage.some((score) => score < 0.5) ||
    evidenceCoverage.filter((score) => score >= 0.8).length <
      Math.min(2, evidenceCoverage.length)
  )
    return null
  if (!haystack.includes(normalize(result.recipe.title))) return null
  if (!result.recipe.ingredients.every((i) => haystack.includes(normalize(i.name)))) return null
  if (!result.recipe.ingredients.every((i) => !i.amount || haystack.includes(normalize(i.amount)))) return null
  if (!result.recipe.ingredients.every((i) => !i.group || haystack.includes(normalize(i.group)))) return null
  if (!result.recipe.steps.every((step) => coverage(step) >= 0.85)) return null
  return result.recipe
}

const outputText = (body) => {
  if (body.status !== 'completed') throw new Error('MODEL_INCOMPLETE')
  const parts = (body.output || []).flatMap((o) => o.content || [])
  if (parts.some((p) => p.type === 'refusal')) return null
  return parts.filter((p) => p.type === 'output_text').map((p) => p.text).join('')
}
async function responseCall(env, fetcher, request) {
  const response = await fetcher('https://api.openai.com/v1/responses', {
    method: 'POST', headers: { Authorization: `Bearer ${env.OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
    signal: AbortSignal.timeout(90000), body: JSON.stringify({ ...request, store: false }),
  })
  if (!response.ok) throw new Error(`MODEL_HTTP_${response.status}`)
  const body = await response.json()
  return { body, text: outputText(body) }
}
const chunkHash = (chunk) => createHash('sha256').update(chunk).digest('hex')
const emptyScan = { classification: 'uncertain', candidateId: null, evidence: [], needsPrevious: false, needsNext: false }

export function extractor(env, fetcher = fetch) {
  const models = importCostConfig(env)
  return async (html, checkpoint = {}) => {
    const source = prepareHtml(html)
    const estimate = estimateImport(html, env)
    const scans = [], calls = []
    await checkpoint.progress?.('scan', 0, estimate.chunks.length)
    for (let index = 0; index < estimate.chunks.length; index++) {
      const chunk = estimate.chunks[index]
      const scanInput = estimate.structuredRecipe
        ? `Primary Recipe JSON-LD:\n${estimate.structuredRecipe}\n\nFragment ${index + 1} of ${estimate.chunks.length}:\n${chunk}`
        : `Fragment ${index + 1} of ${estimate.chunks.length}:\n${chunk}`
      const hash = chunkHash(scanInput)
      let saved = await checkpoint.load?.('scan', index, hash)
      if (!saved) {
        const call = await responseCall(env, fetcher, {
          model: models.scanModel, max_output_tokens: MAX_SCAN_OUTPUT_TOKENS,
          instructions: estimate.structuredRecipe
            ? TARGETED_SCAN_INSTRUCTIONS
            : SCAN_INSTRUCTIONS,
          input: scanInput,
          text: { format: { type: 'json_schema', name: 'recipe_fragment_scan', strict: true, schema: z.toJSONSchema(scanSchema, { target: 'draft-7' }) } },
        })
        const result = call.text ? scanSchema.parse(JSON.parse(call.text)) : emptyScan
        saved = { result, usage: call.body.usage || {}, model: call.body.model }
        await checkpoint.save?.('scan', index, hash, saved)
      }
      scans.push(saved.result)
      calls.push({ phase: 'scan', usage: saved.usage })
      await checkpoint.progress?.('scan', index + 1, estimate.chunks.length)
    }
    const positive = scans.map((scan, index) => ({ ...scan, index })).filter((scan) => scan.classification !== 'none')
    if (!positive.length || positive.some((scan) => ['multiple', 'uncertain'].includes(scan.classification)))
      return { card: null, model: models.scanModel, usage: { calls }, calls }
    const candidateIds = new Set(positive.map((scan) => scan.candidateId).filter(Boolean))
    if (candidateIds.size > 1) return { card: null, model: models.scanModel, usage: { calls }, calls }
    const selected = new Set(positive.map((scan) => scan.index))
    for (const scan of positive) {
      if (scan.needsPrevious && scan.index > 0) selected.add(scan.index - 1)
      if (scan.needsNext && scan.index + 1 < estimate.chunks.length) selected.add(scan.index + 1)
    }
    const ordered = [...selected].sort((a, b) => a - b)
    if (ordered.some((value, i) => i && value !== ordered[i - 1] + 1))
      return { card: null, model: models.scanModel, usage: { calls }, calls }
    const candidateHtml = [
      estimate.structuredRecipe
        ? `Primary Recipe JSON-LD:\n${estimate.structuredRecipe}`
        : '',
      ordered.map((i) => estimate.chunks[i]).join(''),
    ].filter(Boolean).join('\n\nSource HTML context:\n')
    if (countTokens(candidateHtml) > MAX_FINAL_INPUT_TOKENS)
      return { card: null, model: models.scanModel, usage: { calls }, calls }
    await checkpoint.progress?.('extract', estimate.chunks.length, estimate.chunks.length)
    const hash = chunkHash(candidateHtml)
    let saved = await checkpoint.load?.('extract', 0, hash)
    if (!saved) {
      const call = await responseCall(env, fetcher, {
        model: models.extractionModel, max_output_tokens: MAX_MODEL_OUTPUT_TOKENS,
        instructions: EXTRACTION_INSTRUCTIONS,
        input: candidateHtml,
        text: { format: { type: 'json_schema', name: 'recipe_extraction', strict: true, schema: z.toJSONSchema(resultSchema, { target: 'draft-7' }) } },
      })
      saved = { result: call.text ? JSON.parse(call.text) : null, usage: call.body.usage || {}, model: call.body.model }
      await checkpoint.save?.('extract', 0, hash, saved)
    }
    calls.push({ phase: 'extract', usage: saved.usage })
    const card = saved.result ? validateExtraction(saved.result, source) : null
    return { card, model: saved.model, usage: { calls }, calls, creditsUsed: card ? creditsForUsage(calls, env) : 0 }
  }
}

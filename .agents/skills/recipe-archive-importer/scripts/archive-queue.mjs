#!/usr/bin/env node

import { promises as fs } from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { fileURLToPath } from 'node:url'

const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(scriptDir, '../../../..')
const dataDir = path.join(root, 'data')
const indexPath = path.join(dataDir, 'archive-index.json')
const statePath = path.join(dataDir, 'state.json')
const lockPath = path.join(dataDir, 'archive-queue.lock')
const categories = new Set(['主菜', '副菜', '汁物', 'その他'])
const colors = ['linear-gradient(145deg,#849b73,#4f6f58)', 'linear-gradient(145deg,#d4a474,#a6654b)', 'linear-gradient(145deg,#c6ad72,#8c7f55)', 'linear-gradient(145deg,#8da9a0,#55756d)', 'linear-gradient(145deg,#c69788,#945e57)']

function option(name) {
  const index = process.argv.indexOf(`--${name}`)
  return index >= 0 ? process.argv[index + 1] : undefined
}

async function readJson(filePath) {
  return JSON.parse(await fs.readFile(filePath, 'utf8'))
}

async function writeAtomic(filePath, value) {
  const temp = `${filePath}.${process.pid}.${crypto.randomUUID()}.tmp`
  await fs.writeFile(temp, `${JSON.stringify(value, null, 2)}\n`)
  await fs.rename(temp, filePath)
}

function requireArchive(archives, id) {
  const archive = archives.find((item) => item.id === id)
  if (!archive) throw new Error(`archive not found: ${id}`)
  return archive
}

function normalizeRecipe(input, archive) {
  const title = String(input?.title || '').trim()
  const category = String(input?.category || '')
  const ingredients = Array.isArray(input?.ingredients)
    ? input.ingredients.slice(0, 150).map((item) => typeof item === 'string'
      ? { name: item.trim(), amount: '' }
      : { name: String(item?.name || '').trim(), amount: String(item?.amount || '').trim() }).filter((item) => item.name)
    : []
  const steps = Array.isArray(input?.steps) ? input.steps.slice(0, 150).map((step) => String(step).trim()).filter(Boolean) : []
  if (!title) throw new Error('title is required')
  if (!categories.has(category)) throw new Error('category must be 主菜, 副菜, 汁物, or その他')
  if (!ingredients.length) throw new Error('at least one ingredient is required')
  if (!steps.length) throw new Error('at least one step is required')
  const requestedImage = String(input?.image || '')
  const image = archive.assetPaths.includes(requestedImage) ? requestedImage : archive.assetPaths[0]
  const colorIndex = Number.parseInt(archive.contentSha256.slice(0, 2), 16) % colors.length
  return {
    id: crypto.randomUUID(),
    title,
    category,
    minutes: Math.max(1, Number(input.minutes) || 30),
    servings: Math.max(1, Number(input.servings) || 2),
    ingredients,
    steps,
    image,
    color: colors[colorIndex],
    sourceUrl: archive.finalUrl,
    sourceName: archive.sourceName,
    snapshotPath: archive.localUrl,
    tags: Array.isArray(input.tags) ? input.tags.map(String).map((tag) => tag.trim()).filter(Boolean).slice(0, 8) : [],
    createdAt: new Date().toISOString(),
    archiveId: archive.id,
  }
}

async function withLock(action) {
  let handle
  try {
    handle = await fs.open(lockPath, 'wx')
    await handle.writeFile(`${process.pid}\n`)
    return await action()
  } catch (error) {
    if (error?.code === 'EEXIST') throw new Error('another archive queue update is running')
    throw error
  } finally {
    await handle?.close()
    if (handle) await fs.unlink(lockPath).catch(() => {})
  }
}

async function updateStatus(status) {
  const id = option('archive-id')
  if (!id) throw new Error('--archive-id is required')
  const reason = option('reason')
  await withLock(async () => {
    const archives = await readJson(indexPath)
    const archive = requireArchive(archives, id)
    archive.status = status
    archive.lastAttemptAt = new Date().toISOString()
    if (reason) archive.lastError = reason
    else delete archive.lastError
    await writeAtomic(indexPath, archives)
    console.log(JSON.stringify(archive, null, 2))
  })
}

const command = process.argv[2]

if (command === 'list') {
  const status = option('status') || 'pending'
  const archives = await readJson(indexPath)
  const selected = status === 'all' ? archives : archives.filter((archive) => archive.status === status)
  console.log(JSON.stringify(selected.map((archive) => ({
    ...archive,
    absoluteHtmlPath: path.join(root, archive.htmlPath),
  })), null, 2))
} else if (command === 'show') {
  const id = option('archive-id')
  if (!id) throw new Error('--archive-id is required')
  const archive = requireArchive(await readJson(indexPath), id)
  console.log(JSON.stringify({ ...archive, absoluteHtmlPath: path.join(root, archive.htmlPath) }, null, 2))
} else if (command === 'begin') {
  await updateStatus('processing')
} else if (command === 'review') {
  if (!option('reason')) throw new Error('--reason is required')
  await updateStatus('needs_review')
} else if (command === 'fail') {
  if (!option('reason')) throw new Error('--reason is required')
  await updateStatus('failed')
} else if (command === 'requeue') {
  await updateStatus('pending')
} else if (command === 'commit') {
  const id = option('archive-id')
  const recipePath = option('recipe-json')
  if (!id || !recipePath) throw new Error('--archive-id and --recipe-json are required')
  await withLock(async () => {
    const [archives, state, recipeInput] = await Promise.all([
      readJson(indexPath),
      readJson(statePath),
      readJson(path.resolve(process.cwd(), recipePath)),
    ])
    const archive = requireArchive(archives, id)
    const existing = state.recipes.find((recipe) => recipe.archiveId === id)
    if (existing) {
      archive.status = 'imported'
      archive.recipeId = existing.id
      archive.lastAttemptAt = new Date().toISOString()
      delete archive.lastError
      await writeAtomic(indexPath, archives)
      console.log(JSON.stringify({ imported: false, duplicate: true, recipe: existing }, null, 2))
      return
    }
    const recipe = normalizeRecipe(recipeInput, archive)
    state.recipes.unshift(recipe)
    archive.status = 'imported'
    archive.recipeId = recipe.id
    archive.lastAttemptAt = new Date().toISOString()
    delete archive.lastError
    await writeAtomic(statePath, state)
    await writeAtomic(indexPath, archives)
    console.log(JSON.stringify({ imported: true, recipe }, null, 2))
  })
} else {
  console.error('Usage: archive-queue.mjs list|show|begin|commit|review|fail|requeue [options]')
  process.exitCode = 2
}

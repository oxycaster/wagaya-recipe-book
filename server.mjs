import express from 'express'
import * as cheerio from 'cheerio'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import dns from 'node:dns/promises'
import net from 'node:net'
import crypto from 'node:crypto'
import { fileURLToPath } from 'node:url'

const root = path.dirname(fileURLToPath(import.meta.url))
const dataDir = path.join(root, 'data')
const snapshotDir = path.join(dataDir, 'snapshots')
const imageDir = path.join(dataDir, 'images')
const archiveDir = path.join(dataDir, 'archives')
const trashArchiveDir = path.join(dataDir, '.trash', 'archives')
const archiveIndexPath = path.join(dataDir, 'archive-index.json')
const statePath = path.join(dataDir, 'state.json')
const port = Number(process.env.PORT || 4310)
const app = express()

app.use(express.json({ limit: '2mb' }))
app.use('/archive', express.static(dataDir, {
  fallthrough: false,
  setHeaders(res, filePath) {
    res.setHeader('X-Content-Type-Options', 'nosniff')
    if (filePath.endsWith('.html')) {
      // Imported pages are untrusted. A sandboxed origin prevents their scripts,
      // forms, and navigation from reaching this app's local API.
      res.setHeader('Content-Security-Policy', "sandbox; default-src 'none'; img-src data: https: http:; style-src 'unsafe-inline' https: http:; font-src data: https: http:")
      res.setHeader('Referrer-Policy', 'no-referrer')
    }
  },
}))

const colors = ['linear-gradient(145deg,#849b73,#4f6f58)', 'linear-gradient(145deg,#d4a474,#a6654b)', 'linear-gradient(145deg,#c6ad72,#8c7f55)', 'linear-gradient(145deg,#8da9a0,#55756d)', 'linear-gradient(145deg,#c69788,#945e57)']
const ingredient = (name, amount = '') => ({ name, amount })
const recipe = (id, title, category, minutes, color, tags, ingredients, state = 'cook') => ({ id, title, category, minutes, servings: 2, color, tags, ingredients, steps: ['材料の下ごしらえをする。', '調味料を合わせ、火加減を見ながら仕上げる。'], sourceName: 'わたしのレシピ', createdAt: new Date().toISOString(), state })

function initialState() {
  const recipes = [
    recipe('komatsuna', '小松菜の煮びたし', '副菜', 15, colors[0], ['作り置き', '野菜'], [ingredient('小松菜', '1束'), ingredient('油揚げ', '1枚'), ingredient('だし汁', '200ml')], 'leftover'),
    recipe('ingen', 'いんげんの胡麻和え', '副菜', 10, colors[1], ['定番', '野菜'], [ingredient('いんげん', '150g'), ingredient('すり胡麻', '大さじ2')]),
    recipe('chikuzen', '筑前煮', '主菜', 40, colors[2], ['煮物', '根菜'], [ingredient('鶏もも肉', '200g'), ingredient('れんこん', '100g'), ingredient('にんじん', '1/2本')]),
    recipe('nasu', 'なすのひき肉はさみ揚げ', '主菜', 35, colors[4], ['揚げ物', 'なす'], [ingredient('なす', '3本'), ingredient('豚ひき肉', '180g')]),
    recipe('pumpkin', 'かぼちゃの含め煮', '副菜', 20, colors[2], ['作り置き', '翌日もおいしい'], [ingredient('かぼちゃ', '1/4個'), ingredient('だし汁', '200ml')]),
    recipe('sunomono', 'きゅうりとわかめの酢の物', '副菜', 12, colors[3], ['さっぱり', '作り置き'], [ingredient('きゅうり', '1本'), ingredient('乾燥わかめ', '3g')]),
    recipe('kinpira', 'れんこんのきんぴら', '副菜', 15, colors[1], ['作り置き', '根菜'], [ingredient('れんこん', '150g'), ingredient('白ごま', '小さじ1')]),
  ]
  return { recipes, plans: [
    { date: new Date().toLocaleDateString('sv-SE'), items: [
      { id: crypto.randomUUID(), recipeId: 'komatsuna', state: 'leftover', portions: 2 },
      { id: crypto.randomUUID(), recipeId: 'ingen', state: 'cook', portions: 2 },
      { id: crypto.randomUUID(), recipeId: 'chikuzen', state: 'cook', portions: 3 },
      { id: crypto.randomUUID(), recipeId: 'nasu', state: 'cook', portions: 2 },
    ] },
  ] }
}

async function ensureData() {
  await Promise.all([fs.mkdir(snapshotDir, { recursive: true }), fs.mkdir(imageDir, { recursive: true }), fs.mkdir(archiveDir, { recursive: true }), fs.mkdir(trashArchiveDir, { recursive: true })])
  try { await fs.access(statePath) } catch { await fs.writeFile(statePath, JSON.stringify(initialState(), null, 2)) }
  try { await fs.access(archiveIndexPath) } catch { await fs.writeFile(archiveIndexPath, '[]\n') }
}

async function readArchives() {
  return JSON.parse(await fs.readFile(archiveIndexPath, 'utf8'))
}

async function writeJsonAtomic(filePath, value) {
  const temp = `${filePath}.${process.pid}.${crypto.randomUUID()}.tmp`
  await fs.writeFile(temp, `${JSON.stringify(value, null, 2)}\n`)
  await fs.rename(temp, filePath)
}

function isPrivate(address) {
  if (net.isIPv4(address)) {
    const [a, b] = address.split('.').map(Number)
    return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168)
  }
  const normalized = address.toLowerCase()
  return normalized === '::1' || normalized.startsWith('fc') || normalized.startsWith('fd') || normalized.startsWith('fe80:') || normalized.startsWith('::ffff:127.')
}

async function assertPublicUrl(raw) {
  const url = new URL(raw)
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('http/https のURLだけ取り込めます')
  const addresses = await dns.lookup(url.hostname, { all: true })
  if (!addresses.length || addresses.some(({ address }) => isPrivate(address))) throw new Error('ローカルネットワークのURLは取り込めません')
  return url
}

async function safeFetch(raw, maxBytes = 8_000_000) {
  let current = String(raw)
  for (let redirects = 0; redirects <= 5; redirects++) {
    await assertPublicUrl(current)
    const response = await fetch(current, { redirect: 'manual', headers: { 'user-agent': 'Mozilla/5.0 KitchenArchive/1.0', accept: 'text/html,application/xhtml+xml,image/*' }, signal: AbortSignal.timeout(15000) })
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get('location')
      if (!location) throw new Error('移動先のないリダイレクトです')
      current = new URL(location, current).href
      continue
    }
    if (!response.ok) throw new Error(`ページを取得できませんでした（${response.status}）`)
    const declared = Number(response.headers.get('content-length') || 0)
    if (declared > maxBytes) throw new Error('ページのサイズが大きすぎます')
    const buffer = Buffer.from(await response.arrayBuffer())
    if (buffer.length > maxBytes) throw new Error('ページのサイズが大きすぎます')
    return { response, buffer, finalUrl: current }
  }
  throw new Error('リダイレクトが多すぎます')
}

function normalizedUrl(raw) {
  const url = new URL(String(raw))
  url.hash = ''
  return url.href
}

function imageCandidates($, finalUrl) {
  const candidates = [
    $('meta[property="og:image"]').attr('content'),
    $('meta[name="twitter:image"]').attr('content'),
  ]
  $('script[type="application/ld+json"]').each((_, element) => {
    try {
      for (const node of allJsonLd(JSON.parse($(element).text()))) {
        const candidate = imageUrl(node?.image)
        if (candidate) candidates.push(candidate)
      }
    } catch { /* malformed metadata is kept in the archived HTML */ }
  })
  $('main img[src],article img[src]').slice(0, 3).each((_, element) => candidates.push($(element).attr('src')))
  return [...new Set(candidates.filter(Boolean).map((candidate) => {
    try { return new URL(candidate, finalUrl).href } catch { return '' }
  }).filter(Boolean))].slice(0, 3)
}

async function archivePage(rawUrl) {
  const requestedUrl = normalizedUrl(rawUrl)
  const { response, buffer, finalUrl: fetchedUrl } = await safeFetch(requestedUrl)
  const contentType = response.headers.get('content-type') || ''
  if (contentType && !contentType.includes('html') && !contentType.includes('xhtml')) throw new Error('HTMLページではありません')

  const finalUrl = normalizedUrl(fetchedUrl)
  const html = buffer.toString('utf8')
  const $ = cheerio.load(html)
  const id = crypto.randomUUID()
  const recordDir = path.join(archiveDir, id)
  const assetsDir = path.join(recordDir, 'assets')
  await fs.mkdir(assetsDir, { recursive: true })
  await fs.writeFile(path.join(recordDir, 'page.html'), buffer)

  const assetPaths = []
  const candidates = imageCandidates($, finalUrl)
  const settledAssets = await Promise.allSettled(candidates.map(async (candidate, index) => {
    const fetched = await safeFetch(candidate, 5_000_000)
    const type = fetched.response.headers.get('content-type') || ''
    if (!type.startsWith('image/')) throw new Error('画像ではありません')
    const ext = type.includes('png') ? 'png' : type.includes('webp') ? 'webp' : type.includes('gif') ? 'gif' : 'jpg'
    const filename = `image-${index + 1}.${ext}`
    await fs.writeFile(path.join(assetsDir, filename), fetched.buffer)
    return `/archive/archives/${id}/assets/${filename}`
  }))
  for (const result of settledAssets) if (result.status === 'fulfilled') assetPaths.push(result.value)

  const title = $('meta[property="og:title"]').attr('content') || $('h1').first().text() || $('title').text() || finalUrl
  const sourceName = $('meta[property="og:site_name"]').attr('content') || new URL(finalUrl).hostname
  return {
    id,
    requestedUrl,
    finalUrl,
    title: title.replace(/\s+/g, ' ').trim(),
    sourceName: String(sourceName).trim(),
    htmlPath: `data/archives/${id}/page.html`,
    localUrl: `/archive/archives/${id}/page.html`,
    assetPaths,
    contentSha256: crypto.createHash('sha256').update(buffer).digest('hex'),
    archivedAt: new Date().toISOString(),
    status: 'pending',
  }
}

async function mapLimit(values, limit, mapper) {
  const results = new Array(values.length)
  let next = 0
  async function worker() {
    while (next < values.length) {
      const index = next++
      try { results[index] = { status: 'fulfilled', value: await mapper(values[index], index) } }
      catch (reason) { results[index] = { status: 'rejected', reason } }
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, values.length) }, worker))
  return results
}

async function archiveUrls(rawUrls) {
  const existing = await readArchives()
  const additions = []
  const errors = []
  const urls = [...new Set(rawUrls.map((url) => normalizedUrl(url)))]
  const toFetch = []
  for (const url of urls) {
    const duplicate = existing.find((archive) => archive.requestedUrl === url || archive.finalUrl === url)
    if (duplicate) additions.push(duplicate)
    else toFetch.push(url)
  }
  const settled = await mapLimit(toFetch, 6, archivePage)
  settled.forEach((result, index) => {
    if (result.status === 'fulfilled') additions.push(result.value)
    else errors.push({ url: toFetch[index], error: result.reason?.message || 'ページの保存に失敗しました' })
  })
  const newRecords = additions.filter((archive) => !existing.some((current) => current.id === archive.id))
  if (newRecords.length) await writeJsonAtomic(archiveIndexPath, [...newRecords, ...existing])
  return { archives: additions, errors }
}

function allJsonLd(value) {
  if (!value) return []
  if (Array.isArray(value)) return value.flatMap(allJsonLd)
  if (typeof value === 'object') return [value, ...allJsonLd(value['@graph'])]
  return []
}

function hasRecipeType(value) {
  const types = Array.isArray(value?.['@type']) ? value['@type'] : [value?.['@type']]
  return types.some((type) => String(type).toLowerCase() === 'recipe')
}

function parseDuration(value) {
  const match = String(value || '').match(/PT(?:(\d+)H)?(?:(\d+)M)?/i)
  return match ? Number(match[1] || 0) * 60 + Number(match[2] || 0) : 0
}

function instructionText(value) {
  if (!value) return []
  if (typeof value === 'string') return [value]
  if (Array.isArray(value)) return value.flatMap(instructionText)
  if (value.text) return [String(value.text)]
  if (value.itemListElement) return instructionText(value.itemListElement)
  return []
}

function imageUrl(value) {
  const image = Array.isArray(value) ? value[0] : value
  return typeof image === 'string' ? image : image?.url || image?.contentUrl || ''
}

function visibleRecipeData($) {
  const headings = $('h1,h2,h3')
  const findHeading = (pattern) => headings.filter((_, element) => pattern.test($(element).text().replace(/\s+/g, '').trim())).first()
  const materialHeading = findHeading(/^材料(?:\(|（|$)/)
  const stepHeading = findHeading(/^(?:作り方|つくり方|手順)$/)
  if (!materialHeading.length || !stepHeading.length) return null

  const sectionFor = (heading) => {
    const parent = heading.parent()
    const next = heading.next()
    return next.length ? next : parent
  }
  const materialSection = sectionFor(materialHeading)
  const stepSection = sectionFor(stepHeading)
  const ingredients = []
  materialSection.find('tr').each((_, row) => {
    const cells = $(row).find('th,td').map((__, cell) => $(cell).text().replace(/\s+/g, ' ').trim()).get().filter(Boolean)
    if (cells.length) ingredients.push(cells.join(' '))
  })
  if (!ingredients.length) {
    materialSection.find('li,dt').each((_, item) => {
      const text = $(item).text().replace(/\s+/g, ' ').trim()
      if (text) ingredients.push(text)
    })
  }
  const steps = stepSection.find('ol li').map((_, item) => $(item).text().replace(/\s+/g, ' ').trim()).get().filter(Boolean)
  if (!steps.length) {
    stepSection.find('li,p').each((_, item) => {
      const text = $(item).text().replace(/\s+/g, ' ').trim()
      if (text) steps.push(text)
    })
  }
  if (!ingredients.length || !steps.length) return null

  const title = $('h1').first().text().replace(/\s+/g, ' ').trim() || $('title').text().trim()
  const materialText = materialHeading.parent().text().replace(/\s+/g, ' ')
  const servings = materialText.match(/(\d+)\s*人分/)?.[1]
  const siteName = $('meta[property="og:site_name"]').attr('content') || new URL($('link[rel="canonical"]').attr('href') || 'https://local.invalid').hostname
  const category = /味噌汁|みそ汁|スープ|汁物/.test(title) ? '汁物' : 'その他'
  return {
    name: title,
    recipeCategory: category,
    recipeYield: servings || '2',
    recipeIngredient: ingredients,
    recipeInstructions: steps,
    image: $('meta[property="og:image"]').attr('content'),
    author: { name: siteName },
    keywords: $('meta[name="keywords"]').attr('content') || '',
  }
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char])
}

async function saveDirectRecipe(input, index = 0) {
  if (!input?.title || !input?.sourceUrl || !Array.isArray(input?.ingredients) || !Array.isArray(input?.steps)) {
    throw new Error('レシピの保存形式が正しくありません')
  }
  await assertPublicUrl(input.sourceUrl)
  const id = crypto.randomUUID()
  let localImage
  if (input.imageUrl) {
    try {
      const fetched = await safeFetch(new URL(input.imageUrl, input.sourceUrl).href, 5_000_000)
      const contentType = fetched.response.headers.get('content-type') || ''
      const ext = contentType.includes('png') ? 'png' : contentType.includes('webp') ? 'webp' : 'jpg'
      await fs.writeFile(path.join(imageDir, `${id}.${ext}`), fetched.buffer)
      localImage = `/archive/images/${id}.${ext}`
    } catch { /* text remains fully archived when an image host blocks access */ }
  }
  const ingredients = input.ingredients.slice(0, 100).map((item) => ({ name: String(item.name || '').trim(), amount: String(item.amount || '').trim() })).filter((item) => item.name)
  const steps = input.steps.slice(0, 100).map((step) => String(step).trim()).filter(Boolean)
  const snapshot = `<!doctype html><html lang="ja"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${escapeHtml(input.title)}</title><style>body{font-family:system-ui,sans-serif;max-width:760px;margin:40px auto;padding:0 20px;color:#273128;line-height:1.8}h1{font-family:serif}img{max-width:100%;border-radius:14px}li{margin:.55em 0}.source{color:#69756b}</style><h1>${escapeHtml(input.title)}</h1>${localImage ? `<img src="../images/${path.basename(localImage)}" alt="">` : ''}<p class="source">保存元: ${escapeHtml(input.sourceName || new URL(input.sourceUrl).hostname)}</p><h2>材料</h2><ul>${ingredients.map((item) => `<li>${escapeHtml(item.name)}${item.amount ? ` — ${escapeHtml(item.amount)}` : ''}</li>`).join('')}</ul><h2>作り方</h2><ol>${steps.map((step) => `<li>${escapeHtml(step)}</li>`).join('')}</ol></html>`
  await fs.writeFile(path.join(snapshotDir, `${id}.html`), snapshot)
  return {
    id, title: String(input.title).trim(), category: ['主菜', '副菜', '汁物', 'その他'].includes(input.category) ? input.category : 'その他',
    minutes: Math.max(1, Number(input.minutes) || 30), servings: Math.max(1, Number(input.servings) || 2), ingredients, steps,
    image: localImage, color: colors[index % colors.length], sourceUrl: input.sourceUrl,
    sourceName: String(input.sourceName || new URL(input.sourceUrl).hostname), snapshotPath: `/archive/snapshots/${id}.html`,
    tags: Array.isArray(input.tags) ? input.tags.map(String).slice(0, 8) : [], createdAt: new Date().toISOString(),
  }
}

async function importRecipe(rawUrl, index) {
  const { buffer, finalUrl } = await safeFetch(rawUrl)
  const html = buffer.toString('utf8')
  const $ = cheerio.load(html)
  const nodes = []
  $('script[type="application/ld+json"]').each((_, el) => {
    try { nodes.push(...allJsonLd(JSON.parse($(el).text()))) } catch { /* malformed metadata */ }
  })
  const data = nodes.find(hasRecipeType) || visibleRecipeData($)
  if (!data) throw new Error('このページからレシピ情報を見つけられませんでした')
  const id = crypto.randomUUID()
  await fs.writeFile(path.join(snapshotDir, `${id}.html`), html)
  let localImage
  const remoteImage = imageUrl(data.image)
  if (remoteImage) {
    try {
      const absoluteImage = new URL(remoteImage, finalUrl).href
      const fetched = await safeFetch(absoluteImage, 5_000_000)
      const contentType = fetched.response.headers.get('content-type') || ''
      const ext = contentType.includes('png') ? 'png' : contentType.includes('webp') ? 'webp' : 'jpg'
      await fs.writeFile(path.join(imageDir, `${id}.${ext}`), fetched.buffer)
      localImage = `/archive/images/${id}.${ext}`
    } catch { /* recipe remains usable without the image */ }
  }
  const author = typeof data.author === 'string' ? data.author : Array.isArray(data.author) ? data.author[0]?.name : data.author?.name
  const category = String(data.recipeCategory || '').includes('主') ? '主菜' : String(data.recipeCategory || '').includes('副') ? '副菜' : String(data.recipeCategory || '').includes('汁') ? '汁物' : 'その他'
  const ingredients = (data.recipeIngredient || []).map((text) => ({ name: String(text), amount: '' }))
  return {
    id, title: String(data.name || $('title').text() || '名称未設定のレシピ').trim(), category,
    minutes: parseDuration(data.totalTime) || parseDuration(data.cookTime) || 30,
    servings: Number(String(data.recipeYield || '2').match(/\d+/)?.[0] || 2), ingredients,
    steps: instructionText(data.recipeInstructions), image: localImage, color: colors[index % colors.length],
    sourceUrl: finalUrl, sourceName: String(author || new URL(finalUrl).hostname),
    snapshotPath: `/archive/snapshots/${id}.html`, tags: Array.isArray(data.keywords) ? data.keywords.slice(0, 8) : String(data.keywords || '').split(/[,、]/).filter(Boolean).slice(0, 8),
    createdAt: new Date().toISOString(),
  }
}

app.get('/api/state', async (_req, res) => {
  try { res.json(JSON.parse(await fs.readFile(statePath, 'utf8'))) } catch { res.status(500).json({ error: '保存データを読み込めませんでした' }) }
})

app.get('/api/archives', async (_req, res) => {
  try { res.json(await readArchives()) } catch { res.status(500).json({ error: '保存ページを読み込めませんでした' }) }
})

app.delete('/api/archives/:id', async (req, res) => {
  try {
    const archives = await readArchives()
    const index = archives.findIndex((archive) => archive.id === req.params.id)
    if (index < 0) return res.status(404).json({ error: '保存ページが見つかりません' })
    const archive = archives[index]
    if (!['pending', 'needs_review'].includes(archive.status)) {
      return res.status(409).json({ error: '取り込み待ちまたは要確認のページだけ削除できます' })
    }

    const sourceDir = path.join(archiveDir, archive.id)
    const suffix = new Date().toISOString().replace(/[:.]/g, '-')
    const trashedDir = path.join(trashArchiveDir, `${archive.id}-${suffix}`)
    let moved = false
    try {
      await fs.rename(sourceDir, trashedDir)
      moved = true
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error
    }

    try {
      await writeJsonAtomic(archiveIndexPath, archives.filter((_, currentIndex) => currentIndex !== index))
    } catch (error) {
      if (moved) await fs.rename(trashedDir, sourceDir).catch(() => {})
      throw error
    }
    res.json({ ok: true, id: archive.id, recoverable: moved })
  } catch {
    res.status(500).json({ error: '保存ページを削除できませんでした' })
  }
})

app.put('/api/state', async (req, res) => {
  if (!Array.isArray(req.body?.recipes) || !Array.isArray(req.body?.plans)) return res.status(400).json({ error: '保存形式が正しくありません' })
  try { await writeJsonAtomic(statePath, req.body); res.json({ ok: true }) }
  catch { res.status(500).json({ error: '保存できませんでした' }) }
})

async function archiveRequest(req, res) {
  const urls = Array.isArray(req.body?.urls) ? [...new Set(req.body.urls.map(String))].slice(0, 50) : []
  if (!urls.length) return res.status(400).json({ error: 'URLを入力してください' })
  try {
    const result = await archiveUrls(urls)
    res.status(result.archives.length ? 200 : 422).json(result)
  } catch (error) {
    res.status(422).json({ archives: [], errors: [{ error: error?.message || 'ページの保存に失敗しました' }] })
  }
}

app.post('/api/archives', archiveRequest)
// Older browser bundles may still call this path. Keep it archive-only so a
// stale tab can never create recipe cards before the skill is invoked.
app.post('/api/import', archiveRequest)

await ensureData()
const dist = path.join(root, 'dist')
app.use(express.static(dist))
app.get(/.*/, (_req, res) => res.sendFile(path.join(dist, 'index.html')))
app.listen(port, '127.0.0.1', () => console.log(`献立帖: http://127.0.0.1:${port}`))

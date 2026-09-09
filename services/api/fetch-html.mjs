import https from 'node:https'
import http from 'node:http'
import dns from 'node:dns/promises'
import ipaddr from 'ipaddr.js'
import { Fault, requireThat } from './domain.mjs'
import * as cheerio from 'cheerio'
export const MAX_HTML_BYTES = 2_000_000
export const MAX_IMAGE_BYTES = 5_000_000
export function isPublicIP(address) {
  try {
    return ipaddr.process(address).range() === 'unicast'
  } catch {
    return false
  }
}
export function pageUrl(raw) {
  const u = new URL(raw)
  requireThat(
    ['http:', 'https:'].includes(u.protocol) &&
      !u.username &&
      !u.password &&
      (!u.port || ['80', '443'].includes(u.port)),
    400,
    'INVALID_SOURCE_URL',
  )
  u.hash = ''
  return u
}
export async function fetchHtml(raw, { lookup = dns.lookup } = {}) {
  let result
  try {
    result = await fetchResource(raw, {
      lookup,
      maxBytes: MAX_HTML_BYTES,
      accept: 'text/html,application/xhtml+xml',
      contentTypes: ['text/html', 'application/xhtml+xml'],
    })
  } catch (error) {
    if (error.code === 'RESOURCE_UNAVAILABLE')
      throw new Fault(400, 'HTML_UNAVAILABLE')
    if (error.code === 'RESOURCE_TOO_LARGE')
      throw new Fault(413, 'HTML_TOO_LARGE')
    throw error
  }
  const declared = result.contentType.match(/charset=["']?([^;"'\s]+)/i)?.[1]
  const meta = result.buffer
    .subarray(0, 4096)
    .toString('ascii')
    .match(/charset\s*=\s*["']?([\w-]+)/i)?.[1]
  try {
    return {
      html: new TextDecoder(declared || meta || 'utf-8').decode(result.buffer),
      url: result.url,
    }
  } catch {
    throw new Fault(400, 'UNSUPPORTED_ENCODING')
  }
}

async function fetchResource(
  raw,
  { lookup = dns.lookup, maxBytes, accept, contentTypes },
) {
  let u = pageUrl(raw)
  const deadline = Date.now() + 25000
  for (let hop = 0; hop < 6; hop++) {
    const host = u.hostname.replace(/^\[|\]$/g, '')
    const addresses = await Promise.race([
      lookup(host, { all: true }),
      new Promise((_, reject) => {
        const t = setTimeout(() => reject(new Fault(400, 'DNS_TIMEOUT')), 5000)
        t.unref()
      }),
    ])
    requireThat(
      addresses.length && addresses.every((a) => isPublicIP(a.address)),
      400,
      'PRIVATE_URL_DENIED',
    )
    const chosen = addresses[0]
    const response = await new Promise((resolve, reject) => {
      const req = (u.protocol === 'https:' ? https : http).get(
        u,
        {
          // Pin the validated resolution so DNS rebinding cannot connect to another IP.
          lookup: (_hostname, options, cb) =>
            options.all
              ? cb(null, [chosen])
              : cb(null, chosen.address, chosen.family),
          headers: {
            'user-agent': 'WagayaRecipe/1.0',
            accept,
            'accept-encoding': 'identity',
          },
        },
        (res) => {
          const chunks = []
          let size = 0
          if ([301, 302, 303, 307, 308].includes(res.statusCode)) {
            res.resume()
            resolve({ redirect: res.headers.location })
            return
          }
          const contentType = res.headers['content-type'] || ''
          if (
            res.statusCode !== 200 ||
            !contentTypes.some((type) =>
              contentType.toLowerCase().startsWith(type),
            )
          ) {
            res.resume()
            reject(new Fault(400, 'RESOURCE_UNAVAILABLE'))
            return
          }
          res.on('data', (chunk) => {
            size += chunk.length
            if (size > maxBytes)
              req.destroy(new Fault(413, 'RESOURCE_TOO_LARGE'))
            else chunks.push(chunk)
          })
          res.on('error', reject)
          res.on('end', () => {
            resolve({ buffer: Buffer.concat(chunks), contentType })
          })
        },
      )
      const timer = setTimeout(
        () => req.destroy(new Fault(400, 'FETCH_TIMEOUT')),
        Math.max(1, deadline - Date.now()),
      )
      req.on('close', () => clearTimeout(timer))
      req.on('error', reject)
    })
    if (response.buffer !== undefined) return { ...response, url: u.href }
    requireThat(response.redirect, 400, 'INVALID_REDIRECT')
    u = pageUrl(new URL(response.redirect, u).href)
  }
  throw new Fault(400, 'TOO_MANY_REDIRECTS')
}

function allJsonLd(value) {
  if (!value) return []
  if (Array.isArray(value)) return value.flatMap(allJsonLd)
  if (typeof value === 'object')
    return [value, ...allJsonLd(value['@graph'])]
  return []
}

function recipeImage(value) {
  const image = Array.isArray(value) ? value[0] : value
  return typeof image === 'string' ? image : image?.url || image?.contentUrl || ''
}

export function imageCandidate(html, baseUrl) {
  const $ = cheerio.load(html)
  const candidates = []
  $('script[type="application/ld+json"]').each((_, element) => {
    try {
      for (const item of allJsonLd(JSON.parse($(element).text()))) {
        const types = [item?.['@type']].flat().map(String)
        if (types.some((type) => type.toLowerCase() === 'recipe'))
          candidates.push(recipeImage(item.image))
      }
    } catch {
      // Broken structured data remains in the archived HTML.
    }
  })
  candidates.push(
    $('meta[property="og:image"]').attr('content'),
    $('meta[name="twitter:image"]').attr('content'),
    $('article img[src],main img[src]').first().attr('src'),
  )
  for (const candidate of candidates.filter(Boolean)) {
    try {
      const url = new URL(candidate, baseUrl)
      if (['http:', 'https:'].includes(url.protocol)) return url.href
    } catch {
      // Try the next candidate.
    }
  }
  return null
}

const imageMagic = {
  'image/jpeg': (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  'image/png': (b) =>
    b
      .subarray(0, 8)
      .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])),
  'image/webp': (b) =>
    b.subarray(0, 4).toString() === 'RIFF' &&
    b.subarray(8, 12).toString() === 'WEBP',
  'image/gif': (b) => ['GIF87a', 'GIF89a'].includes(b.subarray(0, 6).toString()),
}

export async function fetchImage(raw, options = {}) {
  const result = await fetchResource(raw, {
    lookup: options.lookup || dns.lookup,
    maxBytes: MAX_IMAGE_BYTES,
    accept: 'image/avif,image/webp,image/png,image/jpeg,image/gif',
    contentTypes: Object.keys(imageMagic),
  })
  const type = result.contentType.split(';')[0].trim().toLowerCase()
  requireThat(imageMagic[type]?.(result.buffer), 400, 'INVALID_IMAGE')
  return { buffer: result.buffer, contentType: type, url: result.url }
}

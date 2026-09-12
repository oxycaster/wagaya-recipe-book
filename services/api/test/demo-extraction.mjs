// Simulator-only wiring. This file is not included in the production image.
import { fetchHtml } from '../fetch-html.mjs'
import { extractor } from '../extractor.mjs'

export const MAX_SIMULATOR_MODEL_CALLS = 30

export function simulatorExtraction(
  env,
  { fetchPage = fetchHtml, createExtractor = extractor, modelFetch = fetch } = {},
) {
  const flag = env.SIMULATOR_REAL_EXTRACTION
  if (flag !== undefined && flag !== '0' && flag !== '1')
    throw new Error('SIMULATOR_REAL_EXTRACTION must be 0 or 1')
  if (flag !== '1') return { enabled: false }
  if (env.NODE_ENV === 'production' || env.APP_ENV === 'prod')
    throw new Error('Real simulator extraction is development-only')
  for (const key of ['CLERK_ISSUER_URL', 'OPENAI_API_KEY', 'OPENAI_MODEL'])
    if (!env[key]) throw new Error(`Real simulator extraction needs ${key}`)
  const port = Number(env.DEMO_PORT || 4330)
  if (!Number.isInteger(port) || port < 1 || port > 65535 || port === 4329)
    throw new Error('Real simulator extraction needs a port other than 4329')
  let modelCalls = 0
  const guardedModelFetch = (...args) => {
    if (modelCalls >= MAX_SIMULATOR_MODEL_CALLS)
      throw new Error('SIMULATOR_MODEL_CALL_LIMIT')
    modelCalls++
    return modelFetch(...args)
  }
  return {
    enabled: true,
    port,
    fetchPage,
    extract: createExtractor(env, guardedModelFetch),
  }
}

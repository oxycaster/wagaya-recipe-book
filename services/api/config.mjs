export function config(env = process.env, { worker = false } = {}) {
  const required = [
    'APP_ENV',
    'DATABASE_URL',
    'CLERK_ISSUER_URL',
    'S3_BUCKET',
    'AWS_REGION',
  ]
  required.push(
    ...(worker
      ? ['OPENAI_API_KEY', 'OPENAI_MODEL', 'CLERK_SECRET_KEY']
      : [
          'REVENUECAT_WEBHOOK_SECRET',
          'REVENUECAT_APP_ID',
          'REVENUECAT_ENVIRONMENT',
          'REVENUECAT_PRODUCTS',
        ]),
  )
  for (const key of required) if (!env[key]) throw new Error(`Missing ${key}`)
  if (!['dev', 'prod'].includes(env.APP_ENV)) throw new Error('Invalid APP_ENV')
  if (env.APP_ENV === 'prod' && !env.DATABASE_SSL_CA)
    throw new Error('Missing DATABASE_SSL_CA')
  if (env.APP_ENV === 'prod' && !env.CLERK_AUTHORIZED_PARTIES)
    throw new Error('Missing CLERK_AUTHORIZED_PARTIES')
  if (!worker && env.REVENUECAT_WEBHOOK_SECRET.length < 32)
    throw new Error('Webhook secret must be at least 32 characters')
  const billingEnvironments = worker
    ? []
    : [...new Set(env.REVENUECAT_ENVIRONMENT.split(',').map((v) => v.trim()))]
  if (
    !worker &&
    (!billingEnvironments.length ||
      billingEnvironments.some(
        (value) => !['PRODUCTION', 'SANDBOX'].includes(value),
      ))
  )
    throw new Error('Invalid billing environment')
  const products = worker ? {} : JSON.parse(env.REVENUECAT_PRODUCTS)
  if (
    !worker &&
    (!Object.keys(products).length ||
      Object.values(products).some(
        (n) => !Number.isSafeInteger(n) || n < 1 || n > 10000,
      ))
  )
    throw new Error('Invalid products')
  return {
    webhookSecret: env.REVENUECAT_WEBHOOK_SECRET,
    billing: {
      appId: env.REVENUECAT_APP_ID,
      environments: billingEnvironments,
      products,
    },
  }
}

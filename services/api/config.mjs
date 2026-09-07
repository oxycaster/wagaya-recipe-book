export function config(env = process.env, { worker = false } = {}) {
  const required = ['DATABASE_URL', 'SUPABASE_URL', 'S3_BUCKET', 'AWS_REGION']
  required.push(
    ...(worker
      ? ['OPENAI_API_KEY', 'OPENAI_MODEL', 'SUPABASE_SECRET_KEY']
      : [
          'REVENUECAT_WEBHOOK_SECRET',
          'REVENUECAT_APP_ID',
          'REVENUECAT_ENVIRONMENT',
          'REVENUECAT_PRODUCTS',
        ]),
  )
  for (const key of required) if (!env[key]) throw new Error(`Missing ${key}`)
  if (!worker && env.REVENUECAT_WEBHOOK_SECRET.length < 32)
    throw new Error('Webhook secret must be at least 32 characters')
  if (
    !worker &&
    !['PRODUCTION', 'SANDBOX'].includes(env.REVENUECAT_ENVIRONMENT)
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
      environment: env.REVENUECAT_ENVIRONMENT,
      products,
    },
  }
}

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { databasePoolOptions } from '../db.mjs'
import { config } from '../config.mjs'

const url = 'postgresql://recipe:recipe@127.0.0.1:54329/recipe'
const apiEnv = {
  APP_ENV: 'dev',
  DATABASE_URL: url,
  SUPABASE_URL: 'https://example.supabase.co',
  S3_BUCKET: 'recipe-test',
  AWS_REGION: 'ap-northeast-1',
  REVENUECAT_WEBHOOK_SECRET: 'x'.repeat(32),
  REVENUECAT_APP_ID: 'app-test',
  REVENUECAT_ENVIRONMENT: 'SANDBOX',
  REVENUECAT_PRODUCTS: '{"recipe_import_10":10}',
}

test('dev database connection does not enable TLS implicitly', () => {
  const options = databasePoolOptions(url, { APP_ENV: 'dev' })
  assert.equal(options.ssl, undefined)
})

test('prod database connection requires a trusted CA', () => {
  assert.throws(
    () => databasePoolOptions(url, { APP_ENV: 'prod' }),
    /Missing DATABASE_SSL_CA/,
  )
})

test('prod database connection verifies the server certificate', () => {
  const options = databasePoolOptions(url, {
    APP_ENV: 'prod',
    DATABASE_SSL_CA: '-----BEGIN CERTIFICATE-----\\nexample\\n-----END CERTIFICATE-----',
  })
  assert.deepEqual(options.ssl, {
    ca: '-----BEGIN CERTIFICATE-----\nexample\n-----END CERTIFICATE-----',
    rejectUnauthorized: true,
  })
})

test('unknown deployment environment is rejected', () => {
  assert.throws(
    () => databasePoolOptions(url, { APP_ENV: 'staging' }),
    /Invalid APP_ENV/,
  )
})

test('API configuration accepts the dev environment', () => {
  assert.doesNotThrow(() => config(apiEnv))
})

test('API configuration fails fast when prod CA is absent', () => {
  assert.throws(
    () => config({ ...apiEnv, APP_ENV: 'prod' }),
    /Missing DATABASE_SSL_CA/,
  )
})

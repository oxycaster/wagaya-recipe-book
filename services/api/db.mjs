import pg from 'pg'

export function databasePoolOptions(connectionString, env = process.env) {
  const appEnv = env.APP_ENV || 'dev'
  if (!['dev', 'prod'].includes(appEnv)) throw new Error('Invalid APP_ENV')

  let ssl
  if (appEnv === 'prod') {
    if (!env.DATABASE_SSL_CA) throw new Error('Missing DATABASE_SSL_CA')
    ssl = {
      ca: env.DATABASE_SSL_CA.replaceAll('\\n', '\n'),
      rejectUnauthorized: true,
    }
  }

  return {
    connectionString,
    options: '-c search_path=recipe_cloud',
    max: 10,
    ...(ssl ? { ssl } : {}),
  }
}

export function database(connectionString, env = process.env) {
  const pool = new pg.Pool(databasePoolOptions(connectionString, env))
  return {
    query: (sql, args) => pool.query(sql, args),
    async transaction(fn) {
      const client = await pool.connect()
      try {
        await client.query('BEGIN')
        const value = await fn(client)
        await client.query('COMMIT')
        return value
      } catch (e) {
        await client.query('ROLLBACK')
        throw e
      } finally {
        client.release()
      }
    },
    close: () => pool.end(),
  }
}

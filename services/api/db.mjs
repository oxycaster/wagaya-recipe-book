import pg from 'pg'
export function database(connectionString) {
  const pool = new pg.Pool({
    connectionString,
    options: '-c search_path=recipe_cloud',
    max: 10,
  })
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

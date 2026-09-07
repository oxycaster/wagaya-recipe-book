import { createRemoteJWKSet, jwtVerify } from 'jose'
import { z } from 'zod'
import { Fault } from './domain.mjs'
export function authenticator(supabaseUrl, keySet) {
  const issuer = `${supabaseUrl.replace(/\/$/, '')}/auth/v1`
  const jwks =
    keySet || createRemoteJWKSet(new URL(`${issuer}/.well-known/jwks.json`))
  return async (token) => {
    try {
      const { payload } = await jwtVerify(token, jwks, {
        issuer,
        audience: 'authenticated',
        algorithms: ['ES256', 'RS256'],
      })
      if (payload.role !== 'authenticated' || payload.is_anonymous === true)
        throw new Error()
      return {
        id: z.uuid().parse(payload.sub),
        email: z.email().parse(payload.email),
      }
    } catch {
      throw new Fault(401, 'INVALID_SESSION')
    }
  }
}

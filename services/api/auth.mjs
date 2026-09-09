import { createRemoteJWKSet, jwtVerify } from 'jose'
import { z } from 'zod'
import { Fault, userId } from './domain.mjs'

export function authenticator(clerkIssuer, keySet, authorizedParties = []) {
  const issuer = clerkIssuer.replace(/\/$/, '')
  const jwks =
    keySet || createRemoteJWKSet(new URL(`${issuer}/.well-known/jwks.json`))
  return async (token) => {
    try {
      const { payload } = await jwtVerify(token, jwks, {
        issuer,
        algorithms: ['RS256'],
      })
      if (
        authorizedParties.length &&
        payload.azp &&
        !authorizedParties.includes(payload.azp)
      )
        throw new Error()
      return {
        id: userId.parse(payload.sub),
        email: z.email().parse(payload.email),
      }
    } catch {
      throw new Fault(401, 'INVALID_SESSION')
    }
  }
}

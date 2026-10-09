// Prints an HS256 JWT for seeded member N (scripts/perf/seed.sql) on a local throwaway stack.
//   node scripts/perf/jwt.mjs 7
// The id is md5('member' || N) as a uuid, the way the seed makes it. JWT secret: the CLI's local one.
import { createHash, createHmac } from 'node:crypto'

export const SECRET = process.env.JWT_SECRET ?? 'super-secret-jwt-token-with-at-least-32-characters-long'

export function memberId(n) {
  const h = createHash('md5').update(`member${n}`).digest('hex')
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`
}

export function memberJwt(n, secret = SECRET) {
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url')
  const body = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({
    sub: memberId(n), role: 'authenticated', aud: 'authenticated',
    exp: Math.floor(Date.now() / 1000) + 86400, iat: Math.floor(Date.now() / 1000),
  })}`
  return `${body}.${createHmac('sha256', secret).update(body).digest('base64url')}`
}

if (process.argv[1]?.endsWith('jwt.mjs')) console.log(memberJwt(Number(process.argv[2] ?? 1)))

import { argon2, randomBytes, timingSafeEqual } from 'node:crypto'
import { promisify } from 'node:util'

const argon2Async = promisify(argon2)

/**
 * The Argon2id parameters a new hash is made with: the first configuration the OWASP Password
 * Storage Cheat Sheet recommends (19 MiB of memory, two passes, one lane), which DD-056 cites.
 */
export const ARGON2ID = { memory: 19_456, passes: 2, parallelism: 1, tagLength: 32 } as const

const SALT_BYTES = 16

/**
 * Hashes a password with Argon2id and a fresh random salt (DD-056), in the PHC string format
 * (`$argon2id$v=19$m=…,t=…,p=…$<salt>$<hash>`, unpadded base64), which keeps the parameters and
 * the salt beside the hash so the password can be checked against it later. The password itself is
 * never stored.
 */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_BYTES)
  const hash = await argon2Async('argon2id', {
    message: password,
    nonce: salt,
    parallelism: ARGON2ID.parallelism,
    tagLength: ARGON2ID.tagLength,
    memory: ARGON2ID.memory,
    passes: ARGON2ID.passes,
  })
  const params = `m=${ARGON2ID.memory},t=${ARGON2ID.passes},p=${ARGON2ID.parallelism}`
  return `$argon2id$v=19$${params}$${unpadded(salt)}$${unpadded(hash)}`
}

function unpadded(bytes: Buffer): string {
  return bytes.toString('base64').replace(/=+$/, '')
}

const PHC = /^\$argon2id\$v=19\$m=(\d+),t=(\d+),p=(\d+)\$([A-Za-z0-9+/]+)\$([A-Za-z0-9+/]+)$/

/** The bounds a stored hash's parameters must keep within to be checked at all. */
const MAX_MEMORY = 1_048_576
const MAX_PASSES = 16
const MAX_PARALLELISM = 16

/**
 * Whether `password` is the password `hash`, a PHC string written by `hashPassword`, was made
 * from (DD-056): recomputes the Argon2id hash with the salt and parameters the string names and
 * compares the two in constant time. A string that is not such a hash matches no password.
 */
export async function verifyPassword(hash: string, password: string): Promise<boolean> {
  const match = PHC.exec(hash)
  if (!match) return false
  const [, memory, passes, parallelism, salt = '', tag = ''] = match
  const params = {
    memory: Number(memory),
    passes: Number(passes),
    parallelism: Number(parallelism),
  }
  if (
    params.memory > MAX_MEMORY ||
    params.passes > MAX_PASSES ||
    params.parallelism > MAX_PARALLELISM
  ) {
    return false
  }
  const expected = Buffer.from(tag, 'base64')
  const actual = await argon2Async('argon2id', {
    message: password,
    nonce: Buffer.from(salt, 'base64'),
    ...params,
    tagLength: expected.length,
  }).catch(() => undefined)
  // The same length by construction: the tag length is the stored hash's own.
  return actual !== undefined && timingSafeEqual(actual, expected)
}

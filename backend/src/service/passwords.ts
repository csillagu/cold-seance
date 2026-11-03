import { argon2, randomBytes } from 'node:crypto'
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

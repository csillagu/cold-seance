import { argon2Sync } from 'node:crypto'

/**
 * Whether `hash`, a PHC string, is the Argon2id hash of `password`: recomputes the hash with the
 * salt and parameters the string names and compares. It reads the string independently of the code
 * that wrote it, so a test can tell that what is stored really is the password's Argon2id hash
 * (DD-056) without going through sign-in.
 */
export function argon2idMatches(hash: string, password: string): boolean {
  const match =
    /^\$argon2id\$v=19\$m=(\d+),t=(\d+),p=(\d+)\$([A-Za-z0-9+/]+)\$([A-Za-z0-9+/]+)$/.exec(hash)
  if (!match) return false
  const [, memory, passes, parallelism, salt = '', tag = ''] = match
  const expected = Buffer.from(tag, 'base64')
  const actual = argon2Sync('argon2id', {
    message: password,
    nonce: Buffer.from(salt, 'base64'),
    memory: Number(memory),
    passes: Number(passes),
    parallelism: Number(parallelism),
    tagLength: expected.length,
  })
  return actual.equals(expected)
}

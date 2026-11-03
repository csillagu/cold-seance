import { describe, expect, it } from 'vitest'
import { argon2idMatches } from '../../test/helpers/passwords.ts'
import { ARGON2ID, hashPassword } from './passwords.ts'

const PHC = /^\$argon2id\$v=19\$m=(\d+),t=(\d+),p=(\d+)\$([A-Za-z0-9+/]+)\$([A-Za-z0-9+/]+)$/

describe('hashPassword', () => {
  it('hashes with Argon2id, in the PHC format, with the OWASP parameters (DD-056)', async () => {
    const hash = await hashPassword('correct horse battery staple')
    const match = PHC.exec(hash)
    expect(match).not.toBeNull()
    const [, memory, passes, parallelism, salt = '', tag = ''] = match ?? []
    expect(Number(memory)).toBe(19_456)
    expect(Number(passes)).toBe(2)
    expect(Number(parallelism)).toBe(1)
    expect(ARGON2ID).toMatchObject({ memory: 19_456, passes: 2, parallelism: 1 })
    expect(Buffer.from(salt, 'base64')).toHaveLength(16)
    expect(Buffer.from(tag, 'base64')).toHaveLength(32)
  })

  it('gives a hash that is the Argon2id hash of that password and of no other', async () => {
    const hash = await hashPassword('correct horse battery staple')
    expect(argon2idMatches(hash, 'correct horse battery staple')).toBe(true)
    expect(argon2idMatches(hash, 'correct horse battery stapler')).toBe(false)
  })

  it('salts each hash afresh, so the same password hashes differently each time', async () => {
    const first = await hashPassword('same')
    const second = await hashPassword('same')
    expect(first).not.toBe(second)
    expect(argon2idMatches(first, 'same')).toBe(true)
    expect(argon2idMatches(second, 'same')).toBe(true)
  })

  it('keeps the password itself out of the hash', async () => {
    const hash = await hashPassword('plain-text-secret')
    expect(hash).not.toContain('plain-text-secret')
    expect(hash).not.toContain(Buffer.from('plain-text-secret').toString('base64').slice(0, 12))
  })

  it('hashes passwords outside ASCII', async () => {
    const hash = await hashPassword('jelszó-🔑')
    expect(argon2idMatches(hash, 'jelszó-🔑')).toBe(true)
    expect(argon2idMatches(hash, 'jelszo-🔑')).toBe(false)
  })
})

describe('argon2idMatches (test helper)', () => {
  it('refuses a string that is not an Argon2id PHC string', () => {
    expect(argon2idMatches('plain-text-secret', 'plain-text-secret')).toBe(false)
    expect(argon2idMatches('$argon2i$v=19$m=19456,t=2,p=1$c2FsdA$aGFzaA', 'x')).toBe(false)
  })
})

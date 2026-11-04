import { describe, expect, it, vi } from 'vitest'
import { UnauthenticatedError } from './errors.ts'
import { tokenAuthenticator } from './token-auth.ts'

// The token authenticator reads the token off the request and asks the token service whose it is;
// which tokens count is the service's, tested against the database in
// test/integration/token-auth.test.ts.

const OWNER = '6f1c2a5e-0000-4000-8000-000000000002'

function withHeader(authorization: string | undefined) {
  return { headers: authorization === undefined ? {} : { authorization } }
}

describe('tokenAuthenticator', () => {
  it("answers the token's owner, through the REST API channel", async () => {
    const resolve = vi.fn<(secret: string) => Promise<string | undefined>>(async (secret) =>
      secret === 'cst_good' ? OWNER : undefined,
    )
    const authenticate = tokenAuthenticator({ resolve })
    expect(await authenticate(withHeader('Bearer cst_good'))).toEqual({
      accountId: OWNER,
      channel: 'rest-api',
    })
    expect(resolve).toHaveBeenCalledWith('cst_good')
  })

  it('refuses outright a request whose token the service does not recognise', async () => {
    const resolve = vi.fn<(secret: string) => Promise<string | undefined>>(async () => undefined)
    const authenticate = tokenAuthenticator({ resolve })
    await expect(authenticate(withHeader('Bearer cst_revoked'))).rejects.toThrow(
      UnauthenticatedError,
    )
  })

  it.each([undefined, 'Basic abc', 'Bearer', 'Bearer two words', 'cst_good'])(
    'does not ask the service for the header %s',
    async (header) => {
      const resolve = vi.fn<(secret: string) => Promise<string | undefined>>(async () => OWNER)
      const authenticate = tokenAuthenticator({ resolve })
      expect(await authenticate(withHeader(header))).toBeUndefined()
      expect(resolve).not.toHaveBeenCalled()
    },
  )
})

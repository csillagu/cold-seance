import { describe, expect, it, vi } from 'vitest'
import { UnauthenticatedError } from './errors.ts'
import { sessionAuthenticator } from './session-auth.ts'
import { sessionIdOf } from './session.ts'

// The session check reads the session id off the request's cookie and asks the session service
// whose it is; which sessions exist is the service's, tested against the database in
// test/integration/sessions.test.ts.

const ALICE = '6f1c2a5e-0000-4000-8000-000000000001'

function withCookie(cookie: string | undefined) {
  return { headers: cookie === undefined ? {} : { cookie } }
}

describe('sessionIdOf', () => {
  it.each([
    ['__Host-session=abc', 'abc'],
    ['theme=dark; __Host-session=abc', 'abc'],
    ['__Host-session=abc; theme=dark', 'abc'],
    ['  __Host-session = abc  ', 'abc'],
    ['__Host-session=first; __Host-session=second', 'first'],
    ['__Host-session=a=b', 'a=b'],
  ])('finds the session id in %j', (header, id) => {
    expect(sessionIdOf(header)).toBe(id)
  })

  it.each([
    ['no Cookie header', undefined],
    ['an empty header', ''],
    ['other cookies only', 'theme=dark; lang=en'],
    ['a cookie of another name, the unprefixed one included', 'session=abc; __Host-sessions=abc'],
    ['a pair without a value', '__Host-session'],
    ['an empty session cookie, as signing out leaves', '__Host-session='],
  ])('finds none in %s', (_, header) => {
    expect(sessionIdOf(header)).toBeUndefined()
  })
})

describe('sessionAuthenticator', () => {
  it("answers the session's person, through the UI channel", async () => {
    const resolve = vi.fn<(id: string) => Promise<string | undefined>>(async (id) =>
      id === 'live' ? ALICE : undefined,
    )
    const authenticate = sessionAuthenticator({ resolve })
    expect(await authenticate(withCookie('theme=dark; __Host-session=live'))).toEqual({
      accountId: ALICE,
      channel: 'ui',
    })
    expect(resolve).toHaveBeenCalledWith('live')
  })

  it('refuses outright a request whose session does not exist', async () => {
    const resolve = vi.fn<(id: string) => Promise<string | undefined>>(async () => undefined)
    const authenticate = sessionAuthenticator({ resolve })
    await expect(authenticate(withCookie('__Host-session=signed-out'))).rejects.toThrow(
      UnauthenticatedError,
    )
  })

  it.each([undefined, '', 'theme=dark', '__Host-session='])(
    'leaves a request with the Cookie header %j to the other authenticators',
    async (cookie) => {
      const resolve = vi.fn<(id: string) => Promise<string | undefined>>(async () => ALICE)
      const authenticate = sessionAuthenticator({ resolve })
      expect(await authenticate(withCookie(cookie))).toBeUndefined()
      expect(resolve).not.toHaveBeenCalled()
    },
  )
})

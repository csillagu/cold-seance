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
    ['session=abc', 'abc'],
    ['theme=dark; session=abc', 'abc'],
    ['session=abc; theme=dark', 'abc'],
    ['  session = abc  ', 'abc'],
    ['session=first; session=second', 'first'],
    ['session=a=b', 'a=b'],
  ])('finds the session id in %j', (header, id) => {
    expect(sessionIdOf(header)).toBe(id)
  })

  it.each([
    ['no Cookie header', undefined],
    ['an empty header', ''],
    ['other cookies only', 'theme=dark; lang=en'],
    ['a cookie whose name only starts with session', 'sessions=abc; xsession=abc'],
    ['a pair without a value', 'session'],
    ['an empty session cookie, as signing out leaves', 'session='],
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
    expect(await authenticate(withCookie('theme=dark; session=live'))).toEqual({
      accountId: ALICE,
      channel: 'ui',
    })
    expect(resolve).toHaveBeenCalledWith('live')
  })

  it('refuses outright a request whose session does not exist', async () => {
    const resolve = vi.fn<(id: string) => Promise<string | undefined>>(async () => undefined)
    const authenticate = sessionAuthenticator({ resolve })
    await expect(authenticate(withCookie('session=signed-out'))).rejects.toThrow(
      UnauthenticatedError,
    )
  })

  it.each([undefined, '', 'theme=dark', 'session='])(
    'leaves a request with the Cookie header %j to the other authenticators',
    async (cookie) => {
      const resolve = vi.fn<(id: string) => Promise<string | undefined>>(async () => ALICE)
      const authenticate = sessionAuthenticator({ resolve })
      expect(await authenticate(withCookie(cookie))).toBeUndefined()
      expect(resolve).not.toHaveBeenCalled()
    },
  )
})

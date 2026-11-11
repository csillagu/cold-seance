import { describe, expect, it } from 'vitest'
import { afterSignIn } from './sign-in-redirect.ts'

describe('afterSignIn', () => {
  it('goes on to an address of this site', () => {
    expect(afterSignIn('/projects/1?x=2#y')).toBe('/projects/1?x=2#y')
  })

  it('goes to the start page without one', () => {
    expect(afterSignIn(null)).toBe('/')
  })

  it.each(['https://elsewhere.example', '//elsewhere.example', '/\\elsewhere.example', 'projects'])(
    'ignores %s, which would lead off the site',
    (next) => {
      expect(afterSignIn(next)).toBe('/')
    },
  )
})

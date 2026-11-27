import { describe, expect, it } from 'vitest'
import {
  MAX_PASSWORD_CHECKS,
  SIGN_IN_ATTEMPTS_PER_ADDRESS,
  SIGN_IN_WINDOW_MS,
  SignInLimits,
  TOO_MANY_ATTEMPTS,
  TOO_MANY_CHECKS,
  type Admission,
} from './sign-in-limits.ts'

/** Limits on a clock the test moves by hand, starting at an arbitrary time. */
function limitsAt(start = 1_000_000) {
  const clock = { now: start }
  return { clock, limits: new SignInLimits({ now: () => clock.now }) }
}

function released(admission: Admission): Admission {
  if (admission.admitted) admission.release()
  return admission
}

describe('the sign-in limits (SC-132)', () => {
  it('are the ones the owner set: 10 attempts per address in 60 seconds, 4 checks at once (SRC-298)', () => {
    expect(SIGN_IN_ATTEMPTS_PER_ADDRESS).toBe(10)
    expect(SIGN_IN_WINDOW_MS).toBe(60_000)
    expect(MAX_PASSWORD_CHECKS).toBe(4)
  })

  describe('per address (FR-215)', () => {
    it('admits 10 attempts from one address in 60 seconds and refuses the 11th', () => {
      const { clock, limits } = limitsAt()
      for (let i = 0; i < 10; i++) {
        expect(released(limits.admit('a')).admitted).toBe(true)
        clock.now += 1_000
      }
      const refused = limits.admit('a')
      expect(refused).toEqual({
        admitted: false,
        message: TOO_MANY_ATTEMPTS,
        retryAfterSeconds: 50,
      })
    })

    it('counts each address on its own', () => {
      const { limits } = limitsAt()
      for (let i = 0; i < 10; i++) released(limits.admit('a'))
      expect(limits.admit('a').admitted).toBe(false)
      expect(released(limits.admit('b')).admitted).toBe(true)
    })

    it('admits again once the oldest attempt is 60 seconds old: the window slides', () => {
      const { clock, limits } = limitsAt()
      const start = clock.now
      released(limits.admit('a'))
      clock.now += 30_000
      for (let i = 0; i < 9; i++) released(limits.admit('a'))
      clock.now = start + SIGN_IN_WINDOW_MS - 1
      expect(limits.admit('a')).toMatchObject({ admitted: false, retryAfterSeconds: 1 })
      clock.now = start + SIGN_IN_WINDOW_MS
      expect(released(limits.admit('a')).admitted).toBe(true)
      // The nine of 30 seconds in still fill the window with the one just admitted.
      expect(limits.admit('a').admitted).toBe(false)
    })

    it('does not count an attempt it refused (SRC-298)', () => {
      const { clock, limits } = limitsAt()
      const start = clock.now
      for (let i = 0; i < 10; i++) released(limits.admit('a'))
      for (let i = 0; i < 20; i++) {
        clock.now += 2_000
        expect(limits.admit('a').admitted).toBe(false)
      }
      // A minute after the ten that were counted, the address is admitted again, however often
      // it was refused in between.
      clock.now = start + SIGN_IN_WINDOW_MS
      expect(released(limits.admit('a')).admitted).toBe(true)
    })

    it('forgets an address with no attempt left in the window', () => {
      const { clock, limits } = limitsAt()
      for (let i = 0; i < 10; i++) released(limits.admit('a'))
      clock.now += 2 * SIGN_IN_WINDOW_MS
      for (let i = 0; i < 10; i++) expect(released(limits.admit('a')).admitted).toBe(true)
    })
  })

  describe('password checks at once (FR-216)', () => {
    it('admits 4 checks at once and refuses a 5th at once, from any address', () => {
      const { limits } = limitsAt()
      const running = ['a', 'b', 'c', 'd'].map((address) => limits.admit(address))
      expect(running.every((admission) => admission.admitted)).toBe(true)
      expect(limits.admit('e')).toEqual({
        admitted: false,
        message: TOO_MANY_CHECKS,
        retryAfterSeconds: 1,
      })
    })

    it('admits another once a check is released, and counts a release once', () => {
      const { limits } = limitsAt()
      const running = ['a', 'b', 'c', 'd'].map((address) => limits.admit(address))
      const first = running[0]!
      if (!first.admitted) throw new Error('expected the first check to be admitted')
      first.release()
      first.release()
      expect(limits.admit('e').admitted).toBe(true)
      expect(limits.admit('f').admitted).toBe(false)
    })

    it('does not count an attempt refused for the checks against its address (SRC-298)', () => {
      const { limits } = limitsAt()
      const running = ['a', 'b', 'c', 'd'].map((address) => limits.admit(address))
      for (let i = 0; i < 20; i++) expect(limits.admit('e').admitted).toBe(false)
      for (const admission of running) released(admission)
      for (let i = 0; i < 10; i++) expect(released(limits.admit('e')).admitted).toBe(true)
    })
  })
})

/**
 * The limits on signing in (SC-132, SRC-298), which keep password guessing slow and the memory
 * Argon2id takes for each check (DD-056) bounded: each client address may have 10 attempts in
 * any 60 seconds (FR-215), and at most 4 password checks run at once (FR-216). An attempt
 * refused by either limit is not counted, and its password is never checked.
 */

/** How many attempts an address may have within `SIGN_IN_WINDOW_MS` (FR-215). */
export const SIGN_IN_ATTEMPTS_PER_ADDRESS = 10

/** The window the attempts of an address are counted in: the 60 seconds before each attempt. */
export const SIGN_IN_WINDOW_MS = 60_000

/** How many password checks of sign-in attempts may run at once, across the backend (FR-216). */
export const MAX_PASSWORD_CHECKS = 4

/** What a sign-in refused for its address's attempts is told. */
export const TOO_MANY_ATTEMPTS = 'Too many sign-in attempts. Wait a minute and try again.'

/** What a sign-in refused while the password checks are all taken is told. */
export const TOO_MANY_CHECKS = 'Too many sign-ins at once. Try again.'

/** Whether an attempt may go on to its password check, and if not, why and when to try again. */
export type Admission =
  | { admitted: true; release: () => void }
  | { admitted: false; message: string; retryAfterSeconds: number }

export interface SignInLimitOptions {
  /** The clock, in milliseconds; `Date.now` unless a test gives its own. */
  now?: () => number
}

/**
 * The counts of one running backend, held in its memory. An attempt it admits is counted against
 * its address at once, and holds one of the password checks until `release` is called, which the
 * caller does when the check has ended, whatever its outcome.
 */
export class SignInLimits {
  readonly #now: () => number
  /** The times of each address's admitted attempts within the window, oldest first. */
  readonly #attempts = new Map<string, number[]>()
  #checks = 0
  #sweptAt = 0

  constructor(options: SignInLimitOptions = {}) {
    this.#now = options.now ?? (() => Date.now())
  }

  /** Admits an attempt from `address` to its password check, or refuses it. */
  admit(address: string): Admission {
    const now = this.#now()
    this.#sweep(now)
    const times = this.#recent(address, now)
    const oldest = times[0]
    if (oldest !== undefined && times.length >= SIGN_IN_ATTEMPTS_PER_ADDRESS) {
      const waitMs = oldest + SIGN_IN_WINDOW_MS - now
      return {
        admitted: false,
        message: TOO_MANY_ATTEMPTS,
        retryAfterSeconds: Math.max(1, Math.ceil(waitMs / 1000)),
      }
    }
    if (this.#checks >= MAX_PASSWORD_CHECKS) {
      return { admitted: false, message: TOO_MANY_CHECKS, retryAfterSeconds: 1 }
    }
    times.push(now)
    this.#attempts.set(address, times)
    this.#checks += 1
    let released = false
    return {
      admitted: true,
      release: () => {
        if (released) return
        released = true
        this.#checks -= 1
      },
    }
  }

  /** The times of `address`'s attempts within the window before `now`. */
  #recent(address: string, now: number): number[] {
    const times = this.#attempts.get(address) ?? []
    const from = times.findIndex((time) => time > now - SIGN_IN_WINDOW_MS)
    return from === -1 ? [] : times.slice(from)
  }

  /**
   * Forgets, once a window, the addresses with no attempt left in it, so that the map holds only
   * the addresses that tried to sign in within the last two windows.
   */
  #sweep(now: number): void {
    if (now - this.#sweptAt < SIGN_IN_WINDOW_MS) return
    this.#sweptAt = now
    for (const [address, times] of this.#attempts) {
      if (times.every((time) => time <= now - SIGN_IN_WINDOW_MS)) this.#attempts.delete(address)
    }
  }
}

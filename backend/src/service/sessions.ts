import { randomBytes } from 'node:crypto'
import { and, eq, sql } from 'drizzle-orm'
import type { Database } from '../db/client.ts'
import { accounts, sessions } from '../db/schema.ts'
import { hashSecret } from './api-tokens.ts'
import type { Caller } from './caller.ts'
import { ServiceError } from './errors.ts'
import { hashPassword, verifyPassword } from './passwords.ts'

/** The random bytes in a session's id: 256 bits, so it cannot be guessed. */
const SESSION_ID_BYTES = 32

/** What someone whose username or password is not right is told: not which of the two it was. */
export const SIGN_IN_REFUSED = 'The username or password is not right'

/** What someone asking to end a session that is not theirs is told. */
export const SIGN_OUT_NOT_YOURS = 'That session is not yours to end'

/** A session just created by signing in, with the id the browser is given in its cookie. */
export interface SignedIn {
  accountId: string
  /** The session's id, for the cookie; the database keeps only its hash. */
  sessionId: string
}

/**
 * The browser's sign-in sessions (DD-054). Sign-in (SC-052) checks the password against its
 * Argon2id hash (DD-056) and creates a session stored in PostgreSQL, whose random id the browser
 * gets in a cookie and whose hash alone the database keeps. A wrong password, or a username with no
 * account, creates no session, and the two are refused alike, after the same work, so the answer
 * and its time do not tell whether the account exists. The session check (SC-107) looks a cookie's
 * session up on each request from the browser, and signing out deletes the session at once.
 */
export class SessionService {
  readonly #db: Database
  /**
   * A hash of a random password, which a username with no account is checked against, so that it
   * takes the same time as a wrong password. Made once, when first needed.
   */
  #standIn: Promise<string> | undefined

  constructor(db: Database) {
    this.#db = db
  }

  /** Signs the person in and answers their new session; refused if the credentials are not right. */
  async signIn(credentials: { username: string; password: string }): Promise<SignedIn> {
    const username = credentials.username.normalize('NFC').trim()
    const [account] = await this.#db
      .select({ id: accounts.id, passwordHash: accounts.passwordHash })
      .from(accounts)
      // PostgreSQL's lower() on both sides, as the unique index on usernames uses it.
      .where(sql`lower(${accounts.username}) = lower(${username})`)
    this.#standIn ??= hashPassword(randomBytes(32).toString('base64'))
    const hash = account?.passwordHash ?? (await this.#standIn)
    const matches = await verifyPassword(hash, credentials.password)
    if (!account || !matches) throw new ServiceError('unauthenticated', SIGN_IN_REFUSED)

    const sessionId = randomBytes(SESSION_ID_BYTES).toString('base64url')
    await this.#db
      .insert(sessions)
      .values({ secretHash: hashSecret(sessionId), accountId: account.id })
    return { accountId: account.id, sessionId }
  }

  /**
   * The account whose session the browser's cookie holds the id of, or nothing if no such session
   * exists: it was never created, or its person signed out (SC-107). A session ends only by being
   * deleted, so a session found here is live (DD-054).
   */
  async resolve(sessionId: string): Promise<string | undefined> {
    const [session] = await this.#db
      .select({ accountId: sessions.accountId })
      .from(sessions)
      .where(eq(sessions.secretHash, hashSecret(sessionId)))
    return session?.accountId
  }

  /**
   * Signs the caller out of the session with this id, deleting it at once, so the cookie that held
   * its id no longer acts as anyone (SC-107, DD-054). Only the caller's own session can be ended:
   * the id of someone else's session is refused and deletes nothing, so a caller is never told a
   * session ended that is still live. An id of no session deletes nothing and is not refused.
   */
  async signOut(caller: Caller, sessionId: string): Promise<void> {
    const secretHash = hashSecret(sessionId)
    const deleted = await this.#db
      .delete(sessions)
      .where(and(eq(sessions.secretHash, secretHash), eq(sessions.accountId, caller.accountId)))
      .returning({ id: sessions.id })
    if (deleted.length > 0) return
    if ((await this.resolve(sessionId)) !== undefined) {
      throw new ServiceError('forbidden', SIGN_OUT_NOT_YOURS)
    }
  }
}

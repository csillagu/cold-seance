import { randomBytes } from 'node:crypto'
import { eq, sql } from 'drizzle-orm'
import type { Database } from '../db/client.ts'
import { accounts, sessions } from '../db/schema.ts'
import { hashSecret } from './api-tokens.ts'
import { ServiceError } from './errors.ts'
import { hashPassword, verifyPassword } from './passwords.ts'

/** The random bytes in a session's id: 256 bits, so it cannot be guessed. */
const SESSION_ID_BYTES = 32

/** What someone whose username or password is not right is told: not which of the two it was. */
export const SIGN_IN_REFUSED = 'The username or password is not right'

/** A session just created by signing in, with the id the browser is given in its cookie. */
export interface SignedIn {
  accountId: string
  /** The session's id, for the cookie; the database keeps only its hash. */
  sessionId: string
}

/**
 * Sign-in, the part of the backend that signs a person in with their account held in the tool
 * (DD-027, FR-118) (SC-052): it checks the password against its Argon2id hash (DD-056) and
 * creates a session stored in PostgreSQL, whose random id the browser gets in a cookie and whose
 * hash alone the database keeps (DD-054). A wrong password, or a username with no account, creates
 * no session, and the two are refused alike, after the same work, so the answer and its time do
 * not tell whether the account exists.
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
      .where(eq(sql`lower(${accounts.username})`, username.toLowerCase()))
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
}

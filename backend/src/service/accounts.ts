import { asc, eq } from 'drizzle-orm'
import type { Database } from '../db/client.ts'
import { accounts } from '../db/schema.ts'
import type { Caller } from './caller.ts'
import { ServiceError } from './errors.ts'
import { hashPassword } from './passwords.ts'

/** An account as the service layer hands it out: never with its password hash. */
export interface Account {
  id: string
  username: string
  systemAdmin: boolean
}

export interface NewAccount {
  username: string
  password: string
}

/** The longest username an account can have. */
export const USERNAME_MAX_LENGTH = 100

/**
 * The longest password an account can be given. Hashing it is deliberately costly (DD-056), so a
 * bound keeps one request from making it arbitrarily so.
 */
export const PASSWORD_MAX_LENGTH = 1024

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const columns = {
  id: accounts.id,
  username: accounts.username,
  systemAdmin: accounts.systemAdmin,
} as const

/**
 * Account administration, the part of the service layer through which system admins create the
 * accounts held in the tool (DD-027, FR-117) and make other people system admins (FR-140) (SC-015).
 * There is no way to create an account without being a system admin, so nobody can register
 * themselves. Every call is refused to a caller who is not a system admin before anything else is
 * checked, so a refusal tells such a caller nothing about the accounts that exist.
 */
export class AccountService {
  readonly #db: Database

  constructor(db: Database) {
    this.#db = db
  }

  /**
   * Creates an account with the given username and password; the password is stored only as its
   * Argon2id hash (DD-056). The new account is not a system admin. Refused unless the caller is a
   * system admin; refused if the username is empty, too long or already taken (in any case), or
   * the password is empty or too long.
   */
  async createAccount(caller: Caller, account: NewAccount): Promise<Account> {
    await this.#requireSystemAdmin(caller)
    const username = account.username.trim()
    if (username === '') throw new ServiceError('invalid', 'A username is required')
    if (username.length > USERNAME_MAX_LENGTH) {
      throw new ServiceError(
        'invalid',
        `A username can have at most ${USERNAME_MAX_LENGTH} characters`,
      )
    }
    if (account.password === '') throw new ServiceError('invalid', 'A password is required')
    if (account.password.length > PASSWORD_MAX_LENGTH) {
      throw new ServiceError(
        'invalid',
        `A password can have at most ${PASSWORD_MAX_LENGTH} characters`,
      )
    }

    const passwordHash = await hashPassword(account.password)
    // The unique index on the lower-cased username decides, so two concurrent requests for the
    // same username cannot both succeed.
    const [created] = await this.#db
      .insert(accounts)
      .values({ username, passwordHash })
      .onConflictDoNothing()
      .returning(columns)
    if (!created) {
      throw new ServiceError('conflict', `The username ${username} is already taken`)
    }
    return created
  }

  /**
   * Makes the account `accountId` a system admin (FR-140). Making someone who already is one a
   * system admin changes nothing and succeeds. Refused unless the caller is a system admin; refused
   * as not found if there is no such account.
   */
  async makeSystemAdmin(caller: Caller, accountId: string): Promise<Account> {
    await this.#requireSystemAdmin(caller)
    const [account] = UUID.test(accountId)
      ? await this.#db
          .update(accounts)
          .set({ systemAdmin: true })
          .where(eq(accounts.id, accountId))
          .returning(columns)
      : []
    if (!account) throw new ServiceError('not-found', 'There is no such account')
    return account
  }

  /**
   * Lists every account, by username, for the system admins who administer them (SC-076 picks the
   * person to make a system admin from it). Refused unless the caller is a system admin.
   */
  async listAccounts(caller: Caller): Promise<Account[]> {
    await this.#requireSystemAdmin(caller)
    return this.#db.select(columns).from(accounts).orderBy(asc(accounts.username))
  }

  async #requireSystemAdmin(caller: Caller): Promise<void> {
    const [account] = UUID.test(caller.accountId)
      ? await this.#db
          .select({ systemAdmin: accounts.systemAdmin })
          .from(accounts)
          .where(eq(accounts.id, caller.accountId))
      : []
    if (!account?.systemAdmin) {
      throw new ServiceError('forbidden', 'Only system admins can administer accounts')
    }
  }
}

import { and, asc, eq } from 'drizzle-orm'
import type { Database } from '../db/client.ts'
import { accounts } from '../db/schema.ts'
import type { AuditLogService } from './audit.ts'
import type { Caller } from './caller.ts'
import { violates } from './db-errors.ts'
import { ServiceError } from './errors.ts'
import { hashPassword } from './passwords.ts'
import { characters } from './text.ts'
import { isSystemAdmin, isUuid } from './system-admins.ts'

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

/** The longest username an account can have, in characters. */
export const USERNAME_MAX_LENGTH = 100

/**
 * The longest password an account can be given, in characters: a bound on what is
 * accepted, well above any password a person types.
 */
export const PASSWORD_MAX_LENGTH = 1024

/** The unique index that keeps usernames apart regardless of case (see the schema). */
const USERNAME_INDEX = 'accounts_username_key'

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
 * checked, so a refusal tells such a caller nothing about the accounts that exist. Each change is
 * recorded in the audit log (FR-116, SC-013).
 */
export class AccountService {
  readonly #db: Database
  readonly #audit: AuditLogService

  constructor(db: Database, audit: AuditLogService) {
    this.#db = db
    this.#audit = audit
  }

  /**
   * Creates an account with the given username and password; the password is stored only as its
   * Argon2id hash (DD-056). The new account is not a system admin. Refused unless the caller is a
   * system admin; refused if the username is empty, too long or already taken (in any case), or
   * the password is empty or too long.
   */
  async createAccount(caller: Caller, account: NewAccount): Promise<Account> {
    await this.#requireSystemAdmin(caller)
    const username = checkNewAccount(account)

    const passwordHash = await hashPassword(account.password)
    // The unique index on the lower-cased username decides, so two concurrent requests for the
    // same username cannot both succeed.
    let created: Account | undefined
    try {
      created = await this.#db.transaction(async (tx) => {
        const [row] = await tx
          .insert(accounts)
          .values({ username, passwordHash })
          .returning(columns)
        if (!row) throw new Error('The new account was not returned')
        await this.#audit.record(tx, caller, {
          action: 'account.created',
          subject: { type: 'account', id: row.id },
          details: { username: row.username },
        })
        return row
      })
    } catch (error) {
      if (violates(error, USERNAME_INDEX)) {
        throw new ServiceError('conflict', `The username ${username} is already taken`)
      }
      throw error
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
    if (!isUuid(accountId)) throw new ServiceError('not-found', 'There is no such account')
    const account = await this.#db.transaction(async (tx) => {
      // Only an account that is not yet a system admin is changed, and only a change is logged.
      const [promoted] = await tx
        .update(accounts)
        .set({ systemAdmin: true })
        .where(and(eq(accounts.id, accountId), eq(accounts.systemAdmin, false)))
        .returning(columns)
      if (!promoted) {
        const [unchanged] = await tx
          .select(columns)
          .from(accounts)
          .where(eq(accounts.id, accountId))
        return unchanged
      }
      await this.#audit.record(tx, caller, {
        action: 'account.made-system-admin',
        subject: { type: 'account', id: promoted.id },
        details: { username: promoted.username },
      })
      return promoted
    })
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
    if (!(await isSystemAdmin(this.#db, caller.accountId))) {
      throw new ServiceError('forbidden', 'Only system admins can administer accounts')
    }
  }
}

/**
 * Checks the username and password a new account is to have, and answers the username as it is
 * kept: trimmed, and in one Unicode form, so that the same name typed two ways is one username.
 * Refused if the username is empty or too long, or the password is empty or too long.
 */
export function checkNewAccount(account: NewAccount): string {
  const username = account.username.normalize('NFC').trim()
  if (username === '') throw new ServiceError('invalid', 'A username is required')
  if (characters(username) > USERNAME_MAX_LENGTH) {
    throw new ServiceError(
      'invalid',
      `A username can have at most ${USERNAME_MAX_LENGTH} characters`,
    )
  }
  if (account.password === '') throw new ServiceError('invalid', 'A password is required')
  if (characters(account.password) > PASSWORD_MAX_LENGTH) {
    throw new ServiceError(
      'invalid',
      `A password can have at most ${PASSWORD_MAX_LENGTH} characters`,
    )
  }
  return username
}

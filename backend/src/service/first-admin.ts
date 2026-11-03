import { eq, sql } from 'drizzle-orm'
import type { Database } from '../db/client.ts'
import { accounts } from '../db/schema.ts'
import { checkNewAccount, type NewAccount } from './accounts.ts'
import { ServiceError } from './errors.ts'
import { hashPassword } from './passwords.ts'

/** The start was refused: the first system admin's settings cannot make an account. */
export class FirstAdminError extends Error {
  constructor(message: string) {
    super(`The first system admin cannot be set up, so the tool does not start: ${message}`)
    this.name = 'FirstAdminError'
  }
}

/** What the start did about the first system admin. */
export type FirstAdminOutcome =
  /** There was no system admin, and the one the settings name was created. */
  | 'created'
  /** There is a system admin already, so the settings were not used. */
  | 'exists'

/** Any number, the same in every backend, so that two starting at once take turns. */
const BOOTSTRAP_LOCK = 0x5c053

/**
 * The first system admin bootstrap (SC-053): at start, while no system admin exists yet, creates
 * the one the settings name, from environment variables (FR-165, DD-027), with the username and
 * password given, so that they can sign in and create everyone else's account. Once a system admin
 * exists the settings change nothing, so they can stay in place. Two backends starting at once
 * create it once. Refuses, with a `FirstAdminError`, a username or password no account could have,
 * or a username an account that is not a system admin already has.
 */
export async function setUpFirstAdmin(
  db: Database,
  firstAdmin: NewAccount,
): Promise<FirstAdminOutcome> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(${BOOTSTRAP_LOCK})`)
    const [admin] = await tx
      .select({ id: accounts.id })
      .from(accounts)
      .where(eq(accounts.systemAdmin, true))
      .limit(1)
    if (admin) return 'exists'

    let username: string
    try {
      username = checkNewAccount(firstAdmin)
    } catch (error) {
      if (!(error instanceof ServiceError)) throw error
      throw new FirstAdminError(error.message)
    }
    const [taken] = await tx
      .select({ id: accounts.id })
      .from(accounts)
      // PostgreSQL's lower(), as the unique index on usernames uses it.
      .where(sql`lower(${accounts.username}) = lower(${username})`)
    if (taken) {
      throw new FirstAdminError(`the account ${username} exists already and is not a system admin`)
    }
    await tx.insert(accounts).values({
      username,
      passwordHash: await hashPassword(firstAdmin.password),
      systemAdmin: true,
    })
    return 'created'
  })
}

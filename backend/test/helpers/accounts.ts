import { eq, sql } from 'drizzle-orm'
import type { Authenticator } from '../../src/api/caller.ts'
import type { Database } from '../../src/db/client.ts'
import { accounts } from '../../src/db/schema.ts'
import { hashPassword } from '../../src/service/passwords.ts'

/** The header the test authenticator reads the caller's account id from. */
export const TEST_ACCOUNT_HEADER = 'x-test-account'

/**
 * Recognises the caller from `TEST_ACCOUNT_HEADER`. It stands in for sign-in (SC-052, SC-107) and
 * the API tokens (SC-055), which do not exist yet: it says who the caller is and nothing more, so
 * every permission check is still the service layer's.
 */
export const testAuthenticator: Authenticator = async (request) => {
  const accountId = request.headers[TEST_ACCOUNT_HEADER]
  return typeof accountId === 'string' ? { accountId } : undefined
}

/** Headers that make a request as the given account. */
export function as(account: { id: string }): Record<string, string> {
  return { [TEST_ACCOUNT_HEADER]: account.id }
}

/**
 * Puts an account straight into the database, as the test cases' "fresh test deployment, first
 * system admin `root`" and their other given accounts need. The first system admin's own bootstrap
 * is SC-053.
 */
export async function seedAccount(
  db: Database,
  account: { username: string; password?: string; systemAdmin?: boolean },
): Promise<{ id: string; username: string; systemAdmin: boolean }> {
  const [row] = await db
    .insert(accounts)
    .values({
      username: account.username,
      passwordHash: await hashPassword(account.password ?? `${account.username}-password`),
      systemAdmin: account.systemAdmin ?? false,
    })
    .returning({ id: accounts.id, username: accounts.username, systemAdmin: accounts.systemAdmin })
  if (!row) throw new Error(`could not seed account ${account.username}`)
  return row
}

/** The stored row of the account with the given username, any case, or undefined. */
export async function storedAccount(db: Database, username: string) {
  const [row] = await db
    .select()
    .from(accounts)
    .where(eq(sql`lower(${accounts.username})`, username.toLowerCase()))
  return row
}

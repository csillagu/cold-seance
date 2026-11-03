import { eq } from 'drizzle-orm'
import type { Executor } from '../db/client.ts'
import { accounts } from '../db/schema.ts'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Whether the account `accountId` exists and is a system admin. */
export async function isSystemAdmin(executor: Executor, accountId: string): Promise<boolean> {
  if (!UUID.test(accountId)) return false
  const [account] = await executor
    .select({ systemAdmin: accounts.systemAdmin })
    .from(accounts)
    .where(eq(accounts.id, accountId))
  return account?.systemAdmin === true
}

/** Whether `id` has the form of a UUID, as every id the database gives out does. */
export function isUuid(id: string): boolean {
  return UUID.test(id)
}

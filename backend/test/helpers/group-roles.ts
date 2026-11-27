import { sql } from 'drizzle-orm'
import type { Executor } from '../../src/db/client.ts'
import { type GroupRoles, noGroupRoles, type ProjectRole } from '../../src/service/project-roles.ts'

type Account = { id: string }

/** Group roles from a table, standing in for group membership and projects (SC-057, SC-058). */
export function groupTable(): GroupRoles & {
  give(a: Account, p: string, role: ProjectRole): void
  takeAway(a: Account, p: string): void
} {
  let roles: { accountId: string; projectId: string; role: ProjectRole }[] = []
  return {
    give: (account, projectId, role) => roles.push({ accountId: account.id, projectId, role }),
    takeAway: (account, projectId) => {
      roles = roles.filter((r) => !(r.accountId === account.id && r.projectId === projectId))
    },
    rolesThroughGroups: (accountIds, projectId) => {
      const held = roles.filter(
        (r) => accountIds.includes(r.accountId) && r.projectId === projectId,
      )
      if (held.length === 0) return noGroupRoles.rolesThroughGroups(accountIds, projectId)
      const rows = held.map((r) => sql`(${r.accountId}::uuid, ${r.role}::project_role)`)
      return sql`select * from (values ${sql.join(rows, sql`, `)}) as held(account_id, role)`
    },
    allRolesThroughGroups: async (_executor: Executor, accountId) =>
      roles
        .filter((r) => r.accountId === accountId)
        .map((r) => ({ projectId: r.projectId, role: r.role })),
  }
}

/**
 * Group project assignment for project services whose tests add no project to a group: adding
 * one fails the test.
 */
export const noNewProjectGroups = {
  addNewProject: async (
    _tx: Executor,
    _caller: unknown,
    _project: unknown,
    groupIds: readonly string[],
  ) => {
    if (groupIds.length > 0) throw new Error('This test adds no project to a group')
  },
}

import type { Executor } from '../../src/db/client.ts'
import type { GroupRoles, ProjectRole } from '../../src/service/project-roles.ts'

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
    rolesThroughGroups: async (_executor: Executor, accountId, projectId) =>
      roles
        .filter((r) => r.accountId === accountId && r.projectId === projectId)
        .map((r) => r.role),
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

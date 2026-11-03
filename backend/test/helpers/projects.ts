import { randomUUID } from 'node:crypto'
import type { Database } from '../../src/db/client.ts'
import { projectMembers } from '../../src/db/schema.ts'
import type { ProjectRole } from '../../src/service/project-roles.ts'

/**
 * Gives `account` the role `role` directly in the project, straight in the database, as a test
 * case's given roles need, upserting a role it already holds there.
 */
export async function grantRole(
  db: Database,
  account: { id: string },
  projectId: string,
  role: ProjectRole,
): Promise<void> {
  await db
    .insert(projectMembers)
    .values({ projectId, accountId: account.id, role })
    .onConflictDoUpdate({
      target: [projectMembers.projectId, projectMembers.accountId],
      set: { role },
    })
}

/**
 * A project created by `creator`, who is its only admin, as a test case's "project created by"
 * needs. Projects themselves come with project creation (SC-017); until then a project is an id
 * its creator is admin of.
 */
export async function seedProject(db: Database, creator: { id: string }): Promise<string> {
  const id = randomUUID()
  await grantRole(db, creator, id, 'admin')
  return id
}

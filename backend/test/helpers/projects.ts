import { randomUUID } from 'node:crypto'
import type { Database } from '../../src/db/client.ts'
import { projectMembers, projects } from '../../src/db/schema.ts'
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
 * A project straight in the database, created by `creator` and named `name` (a unique name when
 * not given), with nobody holding a role in it: for tests that set the roles themselves.
 */
export async function insertProject(
  db: Database,
  creator: { id: string },
  name = `project-${randomUUID()}`,
): Promise<string> {
  const [row] = await db
    .insert(projects)
    .values({ name, createdBy: creator.id })
    .returning({ id: projects.id })
  if (!row) throw new Error(`could not seed project ${name}`)
  return row.id
}

/**
 * A project created by `creator`, who is its only admin, as a test case's "project created by"
 * gives it, straight in the database. Tests of project creation itself (SC-017) create theirs
 * through the service.
 */
export async function seedProject(
  db: Database,
  creator: { id: string },
  name?: string,
): Promise<string> {
  const id = await insertProject(db, creator, name)
  await grantRole(db, creator, id, 'admin')
  return id
}

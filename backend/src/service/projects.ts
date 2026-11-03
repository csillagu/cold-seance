import { asc, eq } from 'drizzle-orm'
import type { Database } from '../db/client.ts'
import { accounts, projectMembers, projects } from '../db/schema.ts'
import type { AuditLogService } from './audit.ts'
import type { Caller } from './caller.ts'
import { notVisible, ServiceError } from './errors.ts'
import type { ProjectRoleService } from './project-roles.ts'
import { characters } from './text.ts'
import { isUuid } from './system-admins.ts'

/** A project as the service layer hands it out. */
export interface Project {
  id: string
  name: string
}

/** The longest name a project can have, in characters. */
export const PROJECT_NAME_MAX_LENGTH = 200

const columns = { id: projects.id, name: projects.name } as const

/**
 * Project creation, the part of the service layer through which anyone with an account creates a
 * project and becomes its admin (DD-035, FR-119, FR-158) (SC-017). The creation and its creator's
 * admin role are made in one transaction, with its entry in the audit log (FR-116), so a project
 * never exists without its admin.
 */
export class ProjectService {
  readonly #db: Database
  readonly #audit: AuditLogService
  readonly #roles: ProjectRoleService

  constructor(db: Database, audit: AuditLogService, roles: ProjectRoleService) {
    this.#db = db
    this.#audit = audit
    this.#roles = roles
  }

  /**
   * Creates a project with the given name, and makes the caller its admin. Refused unless the
   * caller has an account; refused if the name is empty or too long.
   */
  async createProject(caller: Caller, project: { name: string }): Promise<Project> {
    if (!(await this.#hasAccount(caller.accountId))) {
      throw new ServiceError('forbidden', 'Only people with an account can create a project')
    }
    // In one Unicode form, so that the same name typed two ways is one name.
    const name = project.name.normalize('NFC').trim()
    if (name === '') throw new ServiceError('invalid', 'A project name is required')
    if (characters(name) > PROJECT_NAME_MAX_LENGTH) {
      throw new ServiceError(
        'invalid',
        `A project name can have at most ${PROJECT_NAME_MAX_LENGTH} characters`,
      )
    }
    return this.#db.transaction(async (tx) => {
      const [created] = await tx
        .insert(projects)
        .values({ name, createdBy: caller.accountId })
        .returning(columns)
      if (!created) throw new Error('The new project was not returned')
      await this.#roles.addCreator(tx, created.id, caller.accountId)
      await this.#audit.record(tx, caller, {
        action: 'project.created',
        subject: { type: 'project', id: created.id },
        projectId: created.id,
        details: { name: created.name },
      })
      return created
    })
  }

  /**
   * The project, for someone who can see it: anyone who holds a role in it (FR-106). Anyone else
   * is told that the project is not visible to them, whether or not it exists (FR-017).
   */
  async getProject(caller: Caller, projectId: string): Promise<Project> {
    const [project] = isUuid(projectId)
      ? await this.#db.select(columns).from(projects).where(eq(projects.id, projectId))
      : []
    if (!project) throw notVisible()
    await this.#roles.permissions.require(caller, projectId, 'read')
    return project
  }

  /**
   * The projects the caller holds a role in directly, by name. Projects reached through groups
   * join them once groups hold projects (SC-058).
   */
  async listProjects(caller: Caller): Promise<Project[]> {
    if (!isUuid(caller.accountId)) return []
    return this.#db
      .select(columns)
      .from(projects)
      .innerJoin(projectMembers, eq(projectMembers.projectId, projects.id))
      .where(eq(projectMembers.accountId, caller.accountId))
      .orderBy(asc(projects.name), asc(projects.id))
  }

  async #hasAccount(accountId: string): Promise<boolean> {
    if (!isUuid(accountId)) return false
    const [account] = await this.#db
      .select({ id: accounts.id })
      .from(accounts)
      .where(eq(accounts.id, accountId))
    return account !== undefined
  }
}

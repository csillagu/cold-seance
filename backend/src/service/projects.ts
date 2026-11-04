import { asc, eq, sql } from 'drizzle-orm'
import type { Database } from '../db/client.ts'
import { accounts, projects } from '../db/schema.ts'
import type { AuditLogService } from './audit.ts'
import type { Caller } from './caller.ts'
import { violates } from './db-errors.ts'
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

/** The unique index that keeps project names apart (see the schema). */
const PROJECT_NAME_INDEX = 'projects_name_key'

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
   * caller has an account; refused if the name is empty or too long, or if another project already
   * has it (FR-120).
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
    // The unique index on names decides (SC-056), so two concurrent creations of one name cannot
    // both succeed.
    try {
      return await this.#createInTransaction(caller, name)
    } catch (error) {
      if (violates(error, PROJECT_NAME_INDEX)) {
        throw new ServiceError('conflict', `A project named ${name} already exists`)
      }
      throw error
    }
  }

  async #createInTransaction(caller: Caller, name: string): Promise<Project> {
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
   * The projects the caller can read, by name: those they hold a role in, directly or through
   * groups (FR-111), as the role store decides.
   */
  async listProjects(caller: Caller): Promise<Project[]> {
    const readable = await this.#roles.readableProjects(caller.accountId)
    if (readable.size === 0) return []
    return (
      this.#db
        .select(columns)
        .from(projects)
        // One array parameter rather than one parameter per project, so that someone who can read
        // very many projects stays within what PostgreSQL takes. The ids come from the role store.
        .where(sql`${projects.id} = any(${`{${[...readable].join(',')}}`}::uuid[])`)
        .orderBy(asc(projects.name), asc(projects.id))
    )
  }

  /**
   * Project search (SC-116): the projects whose name contains `text`, whatever the case of either
   * (FR-183), among only those the caller can read, directly or through groups (FR-184), by name.
   * The text is trimmed first, so spaces around it do not stop a match; an empty text matches
   * every name. A project the caller cannot read is never returned, however well its name matches.
   */
  async searchProjects(caller: Caller, text: string): Promise<Project[]> {
    const wanted = folded(text.trim())
    const readable = await this.listProjects(caller)
    return readable.filter((project) => folded(project.name).includes(wanted))
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

/**
 * A text with case taken out, for matching regardless of case. Upper-casing then lower-casing
 * covers letters whose cases differ in length, such as ß and SS. The letters lower-casing leaves
 * apart are then made one: ß and ẞ become ss, the final ς becomes σ, and the dot that the Turkish
 * İ leaves on its i is dropped. It is done here rather than in the database, so the match does not
 * depend on the database's locale.
 */
function folded(text: string): string {
  return text
    .normalize('NFD')
    .toUpperCase()
    .toLowerCase()
    .replaceAll('ß', 'ss')
    .replaceAll('ς', 'σ')
    .replaceAll('i\u0307', 'i')
    .normalize('NFC')
}

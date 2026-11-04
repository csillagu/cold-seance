import { and, asc, eq } from 'drizzle-orm'
import type { Database, Executor } from '../db/client.ts'
import { accounts, PROJECT_ROLES, projectMembers } from '../db/schema.ts'
import type { AuditLogService } from './audit.ts'
import type { Caller } from './caller.ts'
import { ServiceError } from './errors.ts'
import { allows, ProjectPermissions } from './permissions.ts'
import { isUuid } from './system-admins.ts'

/** The four roles a person can hold in a project (FR-105), lowest first. */
export { PROJECT_ROLES }

export type ProjectRole = (typeof PROJECT_ROLES)[number]

/**
 * Answers a person's role in a project, the highest where they hold several, or `undefined` when
 * they hold none. The project role store (SC-014) is what holds the roles; the modules that decide
 * by role, such as the audit log (SC-013), ask it through this.
 */
export interface ProjectRoles {
  roleOf(accountId: string, projectId: string): Promise<ProjectRole | undefined>
}

/**
 * The roles a person holds in a project through the groups the project is in (FR-111). The
 * groups (SC-057, SC-058) hold them; the role store asks them through this.
 */
export interface GroupRoles {
  rolesThroughGroups(
    executor: Executor,
    accountId: string,
    projectId: string,
  ): Promise<ProjectRole[]>
  /**
   * Every role the person holds through groups, with its project. It must agree with
   * `rolesThroughGroups`, so that the role checks and the view filter decide alike.
   */
  allRolesThroughGroups(
    executor: Executor,
    accountId: string,
  ): Promise<{ projectId: string; role: ProjectRole }[]>
}

/** The group roles until groups hold members and projects (SC-057, SC-058): none. */
export const noGroupRoles: GroupRoles = {
  rolesThroughGroups: async () => [],
  allRolesThroughGroups: async () => [],
}

/** Whether `value` is one of the four project roles. */
export function isProjectRole(value: unknown): value is ProjectRole {
  return PROJECT_ROLES.some((role) => role === value)
}

/** The highest of the given roles (FR-112), or `undefined` when there are none. */
export function highestRole(roles: Iterable<ProjectRole>): ProjectRole | undefined {
  let highest: ProjectRole | undefined
  for (const role of roles) {
    if (highest === undefined || PROJECT_ROLES.indexOf(role) > PROJECT_ROLES.indexOf(highest)) {
      highest = role
    }
  }
  return highest
}

/** A person's role held directly in a project, as the role store hands it out. */
export interface ProjectMember {
  accountId: string
  username: string
  role: ProjectRole
}

const memberColumns = {
  accountId: projectMembers.accountId,
  username: accounts.username,
  role: projectMembers.role,
} as const

/**
 * The project role store, the part of the service layer that holds each person's role in each
 * project (DD-034, FR-105), directly or through groups (FR-111), applies the highest where they
 * hold several (FR-112), and refuses to leave a project without an admin (FR-110) (SC-014).
 *
 * A project's admin manages its members and their roles (UC-025). Each change is recorded in the
 * audit log (FR-116), in the same transaction as the change.
 */
export class ProjectRoleService implements ProjectRoles {
  readonly #db: Database
  readonly #audit: AuditLogService
  readonly #groups: GroupRoles
  /** The role permission checks (SC-049), over the roles this store holds. */
  readonly permissions: ProjectPermissions

  constructor(db: Database, audit: AuditLogService, groups: GroupRoles = noGroupRoles) {
    this.#db = db
    this.#audit = audit
    this.#groups = groups
    this.permissions = new ProjectPermissions(this)
  }

  /**
   * The person's role in the project: the highest of the role they hold directly and the roles
   * they hold through the project's groups (FR-112), or `undefined` when they hold none.
   */
  async roleOf(
    accountId: string,
    projectId: string,
    executor: Executor = this.#db,
  ): Promise<ProjectRole | undefined> {
    if (!isUuid(accountId) || !isUuid(projectId)) return undefined
    const [direct] = await executor
      .select({ role: projectMembers.role })
      .from(projectMembers)
      .where(and(eq(projectMembers.projectId, projectId), eq(projectMembers.accountId, accountId)))
    const throughGroups = await this.#groups.rolesThroughGroups(executor, accountId, projectId)
    return highestRole([...(direct ? [direct.role] : []), ...throughGroups])
  }

  /**
   * The projects the person may read, as the role permission checks decide (SC-049): those they
   * hold a role in that allows reading, directly or through groups, the highest role of each
   * applying (FR-112).
   */
  async readableProjects(accountId: string, executor: Executor = this.#db): Promise<Set<string>> {
    if (!isUuid(accountId)) return new Set()
    const direct = await executor
      .select({ projectId: projectMembers.projectId, role: projectMembers.role })
      .from(projectMembers)
      .where(eq(projectMembers.accountId, accountId))
    const throughGroups = await this.#groups.allRolesThroughGroups(executor, accountId)
    const held = new Map<string, ProjectRole[]>()
    for (const { projectId, role } of [...direct, ...throughGroups]) {
      held.set(projectId, [...(held.get(projectId) ?? []), role])
    }
    const readable = [...held].filter(([, roles]) => allows(highestRole(roles), 'read'))
    return new Set(readable.map(([projectId]) => projectId))
  }

  /**
   * Makes the account `accountId` the admin of the project it has just created (FR-158), in the
   * transaction that creates the project. Project creation (SC-017) calls this; it checks nothing,
   * since whoever creates a project becomes its admin.
   */
  async addCreator(tx: Executor, projectId: string, accountId: string): Promise<void> {
    await tx.insert(projectMembers).values({ projectId, accountId, role: 'admin' })
  }

  /**
   * The people who hold a role in the project directly, by username, with their roles. Anyone who
   * holds a role in the project, of whatever kind, may read them (FR-106); everyone else is told
   * that the project is not visible to them (FR-017).
   */
  async listMembers(caller: Caller, projectId: string): Promise<ProjectMember[]> {
    await this.permissions.require(caller, projectId, 'read')
    return this.#db
      .select(memberColumns)
      .from(projectMembers)
      .innerJoin(accounts, eq(accounts.id, projectMembers.accountId))
      .where(eq(projectMembers.projectId, projectId))
      .orderBy(asc(accounts.username))
  }

  /**
   * Gives the person `accountId` the role `role` in the project directly, adding them as a member
   * or changing the role they hold (UC-025). Refused as not visible to someone with no role in the
   * project (FR-017), and as forbidden to a member who is not its admin (FR-109);
   * refused if the role is not one of the four, if there is no such account, or if it would take
   * the admin role from the project's last admin (FR-110).
   */
  async setRole(
    caller: Caller,
    projectId: string,
    accountId: string,
    role: string,
  ): Promise<ProjectMember> {
    return this.#db.transaction(async (tx) => {
      // The caller is checked before the admins are locked, so that no one else can hold up a
      // project's admins, and again once they are, so that the check still holds at the change.
      await this.#requireAdmin(tx, caller, projectId)
      const admins = await this.#lockAdmins(tx, projectId)
      await this.#requireAdmin(tx, caller, projectId)
      if (!isProjectRole(role)) {
        throw new ServiceError('invalid', `A project role is one of ${PROJECT_ROLES.join(', ')}`)
      }
      const account = isUuid(accountId) ? await this.#account(accountId, tx) : undefined
      if (!account) throw new ServiceError('not-found', 'There is no such account')
      const [current] = await tx
        .select({ role: projectMembers.role })
        .from(projectMembers)
        .where(
          and(eq(projectMembers.projectId, projectId), eq(projectMembers.accountId, accountId)),
        )
      const member = { accountId, username: account.username, role }
      if (current?.role === role) return member
      if (current?.role === 'admin' && admins.length === 1) {
        throw new ServiceError('conflict', "The project's last admin cannot be removed")
      }
      await tx
        .insert(projectMembers)
        .values({ projectId, accountId, role })
        .onConflictDoUpdate({
          target: [projectMembers.projectId, projectMembers.accountId],
          set: { role },
        })
      await this.#audit.record(tx, caller, {
        action: 'project-member.role-set',
        subject: { type: 'account', id: accountId },
        projectId,
        details: { username: account.username, role, previousRole: current?.role ?? null },
      })
      return member
    })
  }

  /**
   * Takes away the role the person `accountId` holds in the project directly (UC-025). Roles they
   * hold through groups stay with the groups. Refused as not visible to someone with no role in the
   * project (FR-017), and as forbidden to a member who is not its admin (FR-109);
   * refused as not found if the person holds no role there directly, and refused if they are the
   * project's last admin (FR-110).
   */
  async removeMember(caller: Caller, projectId: string, accountId: string): Promise<void> {
    await this.#db.transaction(async (tx) => {
      // The caller is checked before the admins are locked, so that no one else can hold up a
      // project's admins, and again once they are, so that the check still holds at the change.
      await this.#requireAdmin(tx, caller, projectId)
      const admins = await this.#lockAdmins(tx, projectId)
      await this.#requireAdmin(tx, caller, projectId)
      const [member] = isUuid(accountId)
        ? await tx
            .select(memberColumns)
            .from(projectMembers)
            .innerJoin(accounts, eq(accounts.id, projectMembers.accountId))
            .where(
              and(eq(projectMembers.projectId, projectId), eq(projectMembers.accountId, accountId)),
            )
        : []
      if (!member) throw new ServiceError('not-found', 'There is no such member')
      if (member.role === 'admin' && admins.length === 1) {
        throw new ServiceError('conflict', "The project's last admin cannot be removed")
      }
      await tx
        .delete(projectMembers)
        .where(
          and(eq(projectMembers.projectId, projectId), eq(projectMembers.accountId, accountId)),
        )
      await this.#audit.record(tx, caller, {
        action: 'project-member.removed',
        subject: { type: 'account', id: accountId },
        projectId,
        details: { username: member.username, previousRole: member.role },
      })
    })
  }

  /**
   * The project's direct admins, their rows locked until the transaction ends, so that two
   * concurrent changes cannot each take away one of the last two admins.
   */
  async #lockAdmins(tx: Executor, projectId: string): Promise<string[]> {
    const rows = await tx
      .select({ accountId: projectMembers.accountId })
      .from(projectMembers)
      .where(and(eq(projectMembers.projectId, projectId), eq(projectMembers.role, 'admin')))
      // In one order, so that two transactions locking the same rows cannot deadlock.
      .orderBy(asc(projectMembers.accountId))
      .for('update')
    return rows.map((row) => row.accountId)
  }

  async #account(accountId: string, executor: Executor) {
    const [account] = await executor
      .select({ username: accounts.username })
      .from(accounts)
      .where(eq(accounts.id, accountId))
    return account
  }

  /** Checked inside the change's transaction, so that it still holds when the change is made. */
  async #requireAdmin(tx: Executor, caller: Caller, projectId: string): Promise<void> {
    await this.permissions.require(caller, projectId, 'manage-project', tx)
  }
}

/**
 * The roles until a role store is given, for tests of modules that ask roles: nobody holds a role
 * in any project, so whatever is granted by a project role is refused to everyone.
 */
export const noProjectRoles: ProjectRoles = {
  roleOf: async () => undefined,
}

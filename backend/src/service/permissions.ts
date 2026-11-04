import type { Executor } from '../db/client.ts'
import type { Caller } from './caller.ts'
import { notVisible, ServiceError } from './errors.ts'
import type { ProjectRole } from './project-roles.ts'

/**
 * What a person may do in a project, by the role they hold there (DD-034):
 *
 * - `read`: see all of its views and data; every role may (FR-106).
 * - `edit-plan`: edit its tasks, plans and assignments (FR-108).
 * - `handle-proposals`: review, edit and approve its AI proposals (FR-108).
 * - `manage-project`: manage its members, roles, repository mapping and settings (FR-109).
 *
 * Setting a task's status is decided by `allowsStatusChange`, since a contributor may set it only
 * on some tasks and to some statuses (FR-107).
 */
export type ProjectAction = 'read' | 'edit-plan' | 'handle-proposals' | 'manage-project'

/**
 * The statuses a task can be in. The task modules (SC-001, SC-003, SC-038) take this one
 * definition over.
 */
export type TaskStatus = 'not-started' | 'in-progress' | 'on-hold' | 'done' | 'cancelled'

/** A change of a task's status, as the permission check needs to know it. */
export interface StatusChange {
  /**
   * The accounts assigned to the task. The check itself decides whether the caller is among them,
   * so no module has to work that out on its own.
   */
  assignees: readonly string[]
  from: TaskStatus
  to: TaskStatus
}

const ALLOWED: Record<ProjectAction, ReadonlySet<ProjectRole>> = {
  read: new Set(['read-only', 'contributor', 'read-write', 'admin']),
  // A project's admin may do everything the read-write role may (FR-109), and also manage the
  // project.
  'edit-plan': new Set(['read-write', 'admin']),
  'handle-proposals': new Set(['read-write', 'admin']),
  'manage-project': new Set(['admin']),
}

/** Why each action is refused to a role that does not allow it; every role may read. */
const REFUSAL: Record<Exclude<ProjectAction, 'read'>, string> = {
  'edit-plan': "Only the project's read-write members and admins can edit its plan",
  'handle-proposals':
    "Only the project's read-write members and admins can handle its AI proposals",
  'manage-project':
    "Only the project's admins can manage its members, roles, repositories and settings",
}

/** The statuses a contributor may set on a task they are assigned to (FR-107). */
const CONTRIBUTOR_TARGETS: ReadonlySet<TaskStatus> = new Set(['in-progress', 'on-hold', 'done'])

/** Whether the role allows the action; no role allows nothing. */
export function allows(role: ProjectRole | undefined, action: ProjectAction): boolean {
  return role !== undefined && ALLOWED[action].has(role)
}

/**
 * Whether the role allows the person `accountId` the status change. Whoever may edit the plan may
 * set any status; a contributor may mark a task they are assigned to as in progress, on hold or
 * finished, but not cancel it, nor reopen a finished one, nor touch a task they are not assigned
 * to (FR-107); the read-only role may set none (FR-106).
 */
export function allowsStatusChange(
  role: ProjectRole | undefined,
  accountId: string,
  change: StatusChange,
): boolean {
  if (allows(role, 'edit-plan')) return true
  if (role !== 'contributor') return false
  return (
    change.assignees.includes(accountId) &&
    change.from !== 'done' &&
    CONTRIBUTOR_TARGETS.has(change.to)
  )
}

/** Answers a person's role in a project, read with `executor` when one is given. */
export interface RoleSource {
  roleOf(
    accountId: string,
    projectId: string,
    executor?: Executor,
  ): Promise<ProjectRole | undefined>
}

/**
 * The role permission checks of the service layer (DD-039, SC-049): each module that reads or
 * changes something in a project asks here first, with the caller and the project, so the same
 * role decides the same way through the UI, the REST API and the MCP server (FR-115). The role is
 * the one the caller holds in that project, directly or through a group (FR-112), so in a view
 * over several projects each card is decided by its own project (FR-060).
 */
export class ProjectPermissions {
  readonly #roles: RoleSource

  constructor(roles: RoleSource) {
    this.#roles = roles
  }

  /**
   * Answers the caller's role in the project if it allows the action. Refuses with `not-visible`
   * when the caller holds no role in the project, so cannot see it at all (FR-017), and with
   * `forbidden` when their role does not allow the action. With `executor`, the role is read in
   * that transaction.
   */
  async require(
    caller: Caller,
    projectId: string,
    action: ProjectAction,
    executor?: Executor,
  ): Promise<ProjectRole> {
    const role = await this.#roles.roleOf(caller.accountId, projectId, executor)
    if (role === undefined) throw notVisible()
    // Every role may read, so only another action can be refused to a role.
    if (action !== 'read' && !allows(role, action)) {
      throw new ServiceError('forbidden', REFUSAL[action])
    }
    return role
  }

  /**
   * Refuses with `not-visible` a status change by someone with no role in the project (FR-017), and
   * with `forbidden` one the caller's role there does not allow. The
   * task's assignees and its status (`from`) must be read in the transaction `executor` that makes
   * the change, with the task locked, so that what is checked is what is changed: otherwise a
   * contributor could, say, reopen a task someone else finished in the meantime.
   */
  async requireStatusChange(
    caller: Caller,
    projectId: string,
    change: StatusChange,
    executor?: Executor,
  ): Promise<void> {
    const role = await this.#roles.roleOf(caller.accountId, projectId, executor)
    if (role === undefined) throw notVisible()
    if (!allowsStatusChange(role, caller.accountId, change)) {
      throw new ServiceError(
        'forbidden',
        role === 'contributor'
          ? 'A contributor can only mark a task they are assigned to as in progress, on hold or finished'
          : "Only the project's read-write members and admins can set the status of its tasks, and its contributors that of tasks they are assigned to",
      )
    }
  }
}

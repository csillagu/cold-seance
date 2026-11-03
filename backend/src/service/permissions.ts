import type { Executor } from '../db/client.ts'
import type { Caller } from './caller.ts'
import { ServiceError } from './errors.ts'
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

/** The statuses a task can be in. */
export type TaskStatus = 'not-started' | 'in-progress' | 'on-hold' | 'done' | 'cancelled'

/** A change of a task's status, as the permission check needs to know it. */
export interface StatusChange {
  /** Whether the person changing it is among the task's assigned people. */
  assignedToCaller: boolean
  from: TaskStatus
  to: TaskStatus
}

const ALLOWED: Record<ProjectAction, ReadonlySet<ProjectRole>> = {
  read: new Set(['read-only', 'contributor', 'read-write', 'admin']),
  'edit-plan': new Set(['read-write', 'admin']),
  'handle-proposals': new Set(['read-write', 'admin']),
  // A project's admin may also do everything the read-write role may (FR-109).
  'manage-project': new Set(['admin']),
}

const REFUSAL: Record<ProjectAction, string> = {
  read: 'Only people with a role in the project can read it',
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
 * Whether the role allows the status change. Whoever may edit the plan may set any status; a
 * contributor may mark a task they are assigned to as in progress, on hold or finished, but not
 * cancel it, nor reopen a finished one, nor touch a task they are not assigned to (FR-107); the
 * read-only role may set none (FR-106).
 */
export function allowsStatusChange(role: ProjectRole | undefined, change: StatusChange): boolean {
  if (allows(role, 'edit-plan')) return true
  if (role !== 'contributor') return false
  return change.assignedToCaller && change.from !== 'done' && CONTRIBUTOR_TARGETS.has(change.to)
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
   * Answers the caller's role in the project if it allows the action, and refuses with
   * `forbidden` otherwise. With `executor`, the role is read in that transaction.
   */
  async require(
    caller: Caller,
    projectId: string,
    action: ProjectAction,
    executor?: Executor,
  ): Promise<ProjectRole> {
    const role = await this.#roles.roleOf(caller.accountId, projectId, executor)
    if (role === undefined || !allows(role, action)) {
      throw new ServiceError('forbidden', REFUSAL[action])
    }
    return role
  }

  /** Refuses with `forbidden` a status change the caller's role in the project does not allow. */
  async requireStatusChange(
    caller: Caller,
    projectId: string,
    change: StatusChange,
    executor?: Executor,
  ): Promise<void> {
    const role = await this.#roles.roleOf(caller.accountId, projectId, executor)
    if (!allowsStatusChange(role, change)) {
      throw new ServiceError(
        'forbidden',
        role === 'contributor'
          ? 'A contributor can only mark a task they are assigned to as in progress, on hold or finished'
          : "Only the project's read-write members and admins can set the status of its tasks",
      )
    }
  }
}

import type { TaskStatus } from '../gantt/gantt-model.ts'
import { movesFrom } from '../kanban/kanban-model.ts'
import type { Role } from '../pages/roles.ts'

/** What the task dialog lets the viewer change of a task, by their role in its project. */
export interface TaskAccess {
  /** Whether every field, the blockers and the parent can be changed. */
  edit: boolean
  /** The statuses the task can be set to; empty when its status cannot be changed. */
  statuses: TaskStatus[]
}

/** The statuses a contributor may set on a task they are assigned to (FR-107). */
const CONTRIBUTOR_TARGETS: readonly TaskStatus[] = ['in-progress', 'on-hold', 'done']

/**
 * What the task dialog offers `viewer` on `task`, held in its project as `role` (#209), as the
 * REST API decides it (FR-106, FR-107, FR-108): the read-write and admin roles may change
 * everything; a contributor may only mark a task they are assigned to as in progress, on hold or
 * finished, and not reopen a finished one; the read-only role may change nothing. The API still
 * decides each change; this only keeps the dialog from offering what it would refuse.
 */
export function taskAccess(
  role: Role,
  viewer: string | undefined,
  task: { status: TaskStatus; assignees: readonly string[] },
): TaskAccess {
  const moves = movesFrom(task.status)
  if (role === 'read-write' || role === 'admin') return { edit: true, statuses: moves }
  if (
    role === 'contributor' &&
    viewer !== undefined &&
    task.assignees.includes(viewer) &&
    task.status !== 'done'
  ) {
    return { edit: false, statuses: moves.filter((status) => CONTRIBUTOR_TARGETS.includes(status)) }
  }
  return { edit: false, statuses: [] }
}

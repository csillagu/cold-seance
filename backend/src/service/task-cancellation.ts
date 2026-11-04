import { and, eq, sql } from 'drizzle-orm'
import type { Database, Executor, Transaction } from '../db/client.ts'
import { taskBlockedBy, tasks } from '../db/schema.ts'
import { TaskAssignments } from './assignment.ts'
import type { AuditLogService } from './audit.ts'
import type { Caller } from './caller.ts'
import { ServiceError } from './errors.ts'
import type { ProjectRoleService } from './project-roles.ts'
import { isUuid } from './system-admins.ts'
import { lockRelations } from './task-relations.ts'
import { type Task, taskColumns, type TaskRow, toCompleteTask } from './tasks.ts'

/**
 * Why a cancellation is refused when passing the task's blockers on would make a task of another
 * project blocked by something that may not block it there (FR-015): only a milestone of another
 * project may block a task. It names no task, since the blocked task's project may be one the
 * caller cannot read (FR-017).
 */
export const CROSS_PROJECT_PASS_ON_MESSAGE =
  'This task cannot be cancelled: a task of another project that it blocks would become blocked ' +
  'by a task of this project that is not a milestone, which only a milestone of another project ' +
  'may be. Remove that blocked-by relation first'

/** A task as the pass-on needs it: which task, its project, and whether it is a milestone. */
interface Linked {
  id: string
  projectId: string
  milestone: boolean
}

const linked = {
  id: tasks.id,
  projectId: tasks.projectId,
  milestone: sql<boolean>`${tasks.milestoneVariant} is not null`,
} as const

/**
 * The task cancellation of the service layer (DD-039, SC-038): it cancels a task in the tool
 * (FR-027) and makes each task it blocked blocked by whatever the cancelled task was blocked by
 * (FR-128, SRC-159).
 *
 * - The task is set to cancelled and stays in its project, with every other field as it was: a
 *   cancelled task is not deleted. Cancelling a task that is already cancelled changes nothing.
 * - Each task the cancelled task blocked loses that relation and gains, in its place, each of the
 *   cancelled task's own blockers it is not blocked by already. No other task gains or loses a
 *   relation; the cancelled task keeps its own blockers. No cycle can arise, since each new
 *   relation follows a path of blocking relations that was already there.
 * - A milestone can block a task of another project (FR-015); if it is cancelled, the tasks it
 *   blocked there would be blocked by its own blockers. Only a milestone of another project may
 *   block a task, so the cancellation is refused as a conflict, changing nothing, if one of those
 *   blockers is not a milestone of a project other than the blocked task's own (owner's decision
 *   of 2026-11-04 for issue #85).
 *
 * Only the project's read-write members and admins may cancel its tasks; a contributor may not
 * (FR-107, `ProjectPermissions.requireStatusChange`), and someone with no role in the project is
 * told it is not visible to them (FR-017). The cancellation and each blocked task's change of
 * relations are recorded in the audit log, each in its own task's project, in the transaction
 * that makes them (FR-116).
 *
 * What else cancelling does is the business of the modules that read a task's status: freeing its
 * load (FR-127, SC-006), showing it in a column for cancelled tasks (FR-129) and closing its GitHub
 * issue as not planned (FR-130, SC-061).
 */
export class TaskCancellationService {
  readonly #db: Database
  readonly #audit: AuditLogService
  readonly #roles: ProjectRoleService

  constructor(db: Database, audit: AuditLogService, roles: ProjectRoleService) {
    this.#db = db
    this.#audit = audit
    this.#roles = roles
  }

  /**
   * Cancels the task, passes its blockers on to the tasks it blocked, and answers the task as it
   * now is. Refused as not found if there is no such task, as not visible to someone with no role
   * in its project, as forbidden to someone whose role there does not allow cancelling it, and as
   * a conflict if passing its blockers on would break FR-015.
   */
  async cancel(caller: Caller, taskId: string): Promise<Task> {
    return this.#db.transaction(async (tx) => {
      // Whoever may not cancel the task is refused before the relations lock, which is one for the
      // whole tool, so that they cannot hold it up; the check is made again once the task is
      // locked, against what it is then. A task never changes project.
      const found = await find(tx, taskId, false)
      await this.#requireCancel(caller, tx, found)
      // The relations lock before the task's row, in the order every change of a relation takes
      // them, so that the relations passed on cannot change under the cancellation.
      await lockRelations(tx)
      const current = await find(tx, taskId, true)
      await this.#requireCancel(caller, tx, current)
      if (current.status === 'cancelled') return this.#out(tx, current)

      const blockers = await blockersOf(tx, current.id)
      const blocked = await blockedBy(tx, current.id)
      for (const task of blocked) {
        if (blockers.some((blocker) => !mayBlock(blocker, task))) {
          throw new ServiceError('conflict', CROSS_PROJECT_PASS_ON_MESSAGE)
        }
      }

      const [updated] = await tx
        .update(tasks)
        .set({ status: 'cancelled' })
        .where(eq(tasks.id, current.id))
        .returning(taskColumns)
      if (!updated) throw new Error('The cancelled task was not returned')
      await this.#audit.record(tx, caller, {
        action: 'task.cancelled',
        subject: { type: 'task', id: current.id },
        projectId: current.projectId,
        details: { previous: { status: current.status } },
      })
      for (const task of blocked) {
        await this.#passOn(tx, caller, current.id, task, blockers)
      }
      return this.#out(tx, updated)
    })
  }

  /**
   * Makes `task` no longer blocked by the cancelled task, and blocked by each of its blockers it
   * is not blocked by already, recording the change in the task's own project.
   */
  async #passOn(
    tx: Transaction,
    caller: Caller,
    cancelledId: string,
    task: Linked,
    blockers: readonly Linked[],
  ): Promise<void> {
    await tx
      .delete(taskBlockedBy)
      .where(and(eq(taskBlockedBy.taskId, task.id), eq(taskBlockedBy.blockerId, cancelledId)))
    const added =
      blockers.length === 0
        ? []
        : await tx
            .insert(taskBlockedBy)
            .values(blockers.map((blocker) => ({ taskId: task.id, blockerId: blocker.id })))
            .onConflictDoNothing()
            .returning({ blockerId: taskBlockedBy.blockerId })
    await this.#audit.record(tx, caller, {
      action: 'task.blockers-passed-on',
      subject: { type: 'task', id: task.id },
      projectId: task.projectId,
      details: {
        cancelledTaskId: cancelledId,
        removedBlockerId: cancelledId,
        // In the cancelled task's order of its blockers, not in the order the database returns.
        addedBlockerIds: blockers
          .map((blocker) => blocker.id)
          .filter((id) => added.some((row) => row.blockerId === id)),
      },
    })
  }

  async #requireCancel(caller: Caller, executor: Executor, task: TaskRow): Promise<void> {
    await this.#roles.permissions.requireStatusChange(
      caller,
      task.projectId,
      { assignees: task.assignees, from: task.status, to: 'cancelled' },
      executor,
    )
  }

  #out(executor: Executor, row: TaskRow): Promise<Task> {
    return toCompleteTask(new TaskAssignments(this.#roles), executor, row)
  }
}

/** Whether `blocker` may block `task` (FR-015): a task of its own project, or a milestone. */
function mayBlock(blocker: Linked, task: Linked): boolean {
  return blocker.projectId === task.projectId || blocker.milestone
}

async function find(executor: Executor, taskId: string, lock: boolean): Promise<TaskRow> {
  if (!isUuid(taskId)) throw noSuchTask()
  const query = executor.select(taskColumns).from(tasks).where(eq(tasks.id, taskId))
  const [task] = lock ? await query.for('update') : await query
  if (!task) throw noSuchTask()
  return task
}

/** The tasks blocking `taskId`, in the order the relations were made. */
function blockersOf(executor: Executor, taskId: string): Promise<Linked[]> {
  return executor
    .select(linked)
    .from(taskBlockedBy)
    .innerJoin(tasks, eq(tasks.id, taskBlockedBy.blockerId))
    .where(eq(taskBlockedBy.taskId, taskId))
    .orderBy(taskBlockedBy.createdAt, tasks.id)
}

/** The tasks `taskId` blocks, of any project. */
function blockedBy(executor: Executor, taskId: string): Promise<Linked[]> {
  return executor
    .select(linked)
    .from(taskBlockedBy)
    .innerJoin(tasks, eq(tasks.id, taskBlockedBy.taskId))
    .where(eq(taskBlockedBy.blockerId, taskId))
    .orderBy(taskBlockedBy.createdAt, tasks.id)
}

function noSuchTask(): ServiceError {
  return new ServiceError('not-found', 'There is no such task')
}

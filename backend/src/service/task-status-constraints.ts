import { sql } from 'drizzle-orm'
import type { Transaction } from '../db/client.ts'
import { taskBlockedBy, tasks } from '../db/schema.ts'
import { ServiceError } from './errors.ts'
import type { TaskStatus } from './permissions.ts'

/** What the constraint checks need of the task whose status is being set. */
export interface ConstrainedTask {
  id: string
  actualStart: string | null
}

/**
 * The statuses in which a task is closed: done, or cancelled (SC-038). A subtask in any other
 * status is open (FR-025).
 */
const CLOSED: ReadonlySet<TaskStatus> = new Set(['done', 'cancelled'])

/** The one status in which a blocker has finished (FR-026): a cancelled task has not. */
const FINISHED: TaskStatus = 'done'

export const OPEN_SUBTASK_MESSAGE = 'A task cannot be finished while one of its subtasks is open'

export const UNFINISHED_BLOCKER_MESSAGE =
  'A task cannot be started or finished before every task blocking it has finished'

/**
 * Whether setting a task to `to` is a move the constraint checks may refuse, so that the caller
 * takes the relations lock (`lockRelations`) before it locks the task: finishing a task, or
 * setting it in progress, which starts it unless it has started before.
 */
export function mayBeConstrained(to: TaskStatus): boolean {
  return to === 'done' || to === 'in-progress'
}

/**
 * The task status constraint checks of the service layer (DD-039, SC-037). They refuse, as a
 * conflict with the task's relations, a move of `task` to `to` that:
 *
 * - finishes a parent task while one of its subtasks, at any depth, is open: in any status but
 *   done or cancelled (FR-025, SRC-020);
 * - starts a task, setting it in progress for the first time (it has no actual start), or
 *   finishes it, before every task blocking it has finished: is done (FR-026, SRC-021). A
 *   cancelled blocker has not finished; its cancellation hands its own blockers on to the tasks it
 *   blocked (FR-128). Setting a task that has started before back to in progress, from on hold or
 *   done, is not starting it, and is not checked.
 *
 * They are called by the status transitions (SC-003) for every move, whichever channel it comes
 * through (FR-115), in the transaction that makes it, after the relations lock and the task's own
 * row lock are taken. The subtasks and blockers they read are locked against change until the
 * transaction ends, so that a subtask reopened or a blocker set back at the same time cannot slip
 * past them. The refusal names neither subtask nor blocker: a blocker can be a milestone of a
 * project the caller cannot read (FR-015, FR-017).
 */
export async function checkStatusConstraints(
  tx: Transaction,
  task: ConstrainedTask,
  to: TaskStatus,
): Promise<void> {
  if (to === 'done' && (await hasOpenSubtask(tx, task.id))) {
    throw new ServiceError('conflict', OPEN_SUBTASK_MESSAGE)
  }
  const starts = to === 'in-progress' && task.actualStart === null
  if ((starts || to === 'done') && (await hasUnfinishedBlocker(tx, task.id))) {
    throw new ServiceError('conflict', UNFINISHED_BLOCKER_MESSAGE)
  }
}

/** Whether one of the task's subtasks, at any depth, is open. */
async function hasOpenSubtask(tx: Transaction, taskId: string): Promise<boolean> {
  // Every subtask is locked, not only the open ones: a subtask being reopened at this moment is
  // waited for and read as it is once reopened.
  const result = await tx.execute<{ status: TaskStatus }>(sql`
    with recursive below(id) as (
      select ${tasks.id} from ${tasks} where ${tasks.parentId} = ${taskId}::uuid
      union
      select ${tasks.id} from ${tasks} join below on ${tasks.parentId} = below.id
    )
    select ${tasks.status} as status from ${tasks}
    where ${tasks.id} in (select id from below)
    for share
  `)
  return result.rows.some((row) => !CLOSED.has(row.status))
}

/** Whether a task blocking the task, of its project or another, has not finished. */
async function hasUnfinishedBlocker(tx: Transaction, taskId: string): Promise<boolean> {
  const result = await tx.execute<{ status: TaskStatus }>(sql`
    select ${tasks.status} as status from ${tasks}
    where ${tasks.id} in (
      select ${taskBlockedBy.blockerId} from ${taskBlockedBy}
      where ${taskBlockedBy.taskId} = ${taskId}::uuid
    )
    for share
  `)
  return result.rows.some((row) => row.status !== FINISHED)
}

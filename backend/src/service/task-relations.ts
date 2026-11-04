import { and, asc, eq, sql } from 'drizzle-orm'
import type { Database, Executor, Transaction } from '../db/client.ts'
import { taskBlockedBy, tasks } from '../db/schema.ts'
import type { AuditLogService } from './audit.ts'
import type { Caller } from './caller.ts'
import { ServiceError } from './errors.ts'
import type { ProjectRoleService } from './project-roles.ts'
import { isUuid } from './system-admins.ts'
import type { ViewReadFilter } from './view-filter.ts'

/** Whether `value` is a UUID: what a channel may hand over as a task's id is checked here. */
function isTaskId(value: unknown): value is string {
  return typeof value === 'string' && isUuid(value)
}

/** A task as a relation names it: which task, and the project that owns it. */
export interface TaskRef {
  id: string
  projectId: string
}

/**
 * A task's relations as the relation module hands them out (SC-002): the task it is a subtask of,
 * if any; its own subtasks; and the tasks it is blocked by, each of its own project or a milestone
 * of another project (FR-015). A blocked-by relation is the blocked task's, held in its project,
 * so a task's relations list only what it is blocked by, never what it blocks. Like every view,
 * they show only the tasks their reader can read (FR-059): a blocker of a project the reader
 * cannot read is left out.
 */
export interface TaskRelations {
  taskId: string
  parent: TaskRef | null
  /** Its subtasks, in the order they were created. */
  subtasks: TaskRef[]
  /** What it is blocked by, in the order the relations were made. */
  blockedBy: TaskRef[]
}

/**
 * The key of the transaction-level advisory lock that every change of a relation takes, so that
 * two changes made at once cannot each pass the cycle check and together close a cycle. A cycle of
 * blocked-by relations can run through several projects, so the lock is one for the whole tool.
 */
const RELATIONS_LOCK = 0x5c_00_02

/**
 * Takes the relations lock for the rest of the transaction. Every module that writes a task's
 * parent or its blocked-by relations takes it first, so that the checks made here still hold.
 */
export async function lockRelations(tx: Transaction): Promise<void> {
  await tx.execute(sql`select pg_advisory_xact_lock(${RELATIONS_LOCK})`)
}

interface Found {
  id: string
  projectId: string
  milestone: boolean
  parentId: string | null
}

const found = {
  id: tasks.id,
  projectId: tasks.projectId,
  milestone: sql<boolean>`${tasks.milestoneVariant} is not null`,
  parentId: tasks.parentId,
} as const

/**
 * The task relation module of the service layer (DD-039, SC-002): it records and validates the
 * relations between tasks.
 *
 * - **Subtask and parent.** A task can be made a subtask of another task of its project, and
 *   subtasks nest; a task has at most one parent, and is never its own ancestor. A milestone can
 *   be neither a subtask nor a parent (FR-193).
 * - **Blocked by, within a project.** A task can be blocked by another task of its project. A
 *   blocked-by relation that would close a cycle in the blocking relations is rejected when it is
 *   saved (FR-014), wherever the cycle runs, across projects included.
 * - **Blocked by another project's milestone.** A task can be blocked by a milestone, fixed-date
 *   or floating, that another project owns; the dependency is recorded in the task's project and
 *   changes nothing in the milestone's (FR-015). Only someone who can read the milestone's project
 *   can make it (FR-016); to anyone else the project is reported as not visible (FR-017). Of
 *   another project, only a milestone can block a task.
 *
 * Anyone with a role in a task's project may read its relations (FR-106), less the blockers of
 * projects they cannot read (FR-059); only its read-write
 * members and admins may change them (FR-108). Each change is recorded in the audit log, in the
 * project of the task whose relation it is, in the transaction that makes it (FR-116).
 */
export class TaskRelationService {
  readonly #db: Database
  readonly #audit: AuditLogService
  readonly #roles: ProjectRoleService
  readonly #filter: ViewReadFilter

  constructor(
    db: Database,
    audit: AuditLogService,
    roles: ProjectRoleService,
    filter: ViewReadFilter,
  ) {
    this.#db = db
    this.#audit = audit
    this.#roles = roles
    this.#filter = filter
  }

  /**
   * The task's parent, subtasks and blockers, for anyone with a role in its project. Refused as
   * not found if there is no such task, and as not visible to someone with no role in its project.
   */
  async getRelations(caller: Caller, taskId: string): Promise<TaskRelations> {
    const task = await this.#find(taskId, this.#db)
    await this.#roles.permissions.require(caller, task.projectId, 'read')
    return this.#relationsOf(caller, this.#db, task)
  }

  /**
   * Makes the task a subtask of `parentId`, or, given `null`, of no task. Refused as not found if
   * there is no such task, as not visible to someone with no role in its project, and as forbidden
   * to someone whose role there does not allow editing the plan. Refused as invalid if the parent
   * is not a task of the same project, if either task is a milestone (FR-193), or if the parent is
   * the task itself or one of its subtasks at any depth.
   */
  async setParent(caller: Caller, taskId: string, parentId: unknown): Promise<TaskRelations> {
    return this.#change(caller, taskId, async (tx, task) => {
      const parent = parentId === null ? null : await this.#parent(tx, task, parentId)
      if ((parent?.id ?? null) === task.parentId) return
      if (parent !== null) {
        if (task.milestone) throw invalid('A milestone cannot be a subtask of another task')
        if (parent.milestone) throw invalid('A task cannot be a subtask of a milestone')
        if (await isAncestorOrSelf(tx, task.id, parent.id)) {
          throw invalid('A task cannot be a subtask of itself or of one of its own subtasks')
        }
      }
      await tx
        .update(tasks)
        .set({ parentId: parent?.id ?? null })
        .where(eq(tasks.id, task.id))
      await this.#audit.record(tx, caller, {
        action: 'task.parent-set',
        subject: { type: 'task', id: task.id },
        projectId: task.projectId,
        details: { parentId: parent?.id ?? null, previousParentId: task.parentId },
      })
    })
  }

  /**
   * Makes the task blocked by `blockerId`; nothing changes if it already is. Refused as not found
   * if either task does not exist, as not visible to someone with no role in the task's project,
   * and as forbidden to someone whose role there does not allow editing the plan. A blocker of
   * another project is refused as not visible to someone who cannot read that project (FR-016),
   * and as invalid if it is not a milestone (FR-015). Refused as invalid, too, if the relation
   * would close a cycle in the blocking relations, the task blocking itself included (FR-014).
   */
  async addBlocker(caller: Caller, taskId: string, blockerId: unknown): Promise<TaskRelations> {
    return this.#change(caller, taskId, async (tx, task) => {
      const blocker = await this.#find(blockerId, tx)
      if (blocker.projectId !== task.projectId) {
        // Before anything about the blocker is told, so that someone who cannot read its project
        // learns nothing about it (FR-016, FR-017).
        await this.#roles.permissions.require(caller, blocker.projectId, 'read', tx)
        if (!blocker.milestone) {
          throw invalid("A task can be blocked by another project's milestone, not by its tasks")
        }
      }
      if (await isBlockedBy(tx, blocker.id, task.id)) {
        throw invalid(
          'This blocked-by relation would create a cycle: the blocker is already blocked by ' +
            'this task, directly or through other tasks',
        )
      }
      const added = await tx
        .insert(taskBlockedBy)
        .values({ taskId: task.id, blockerId: blocker.id })
        .onConflictDoNothing()
        .returning({ blockerId: taskBlockedBy.blockerId })
      if (added.length === 0) return
      await this.#audit.record(tx, caller, {
        action: 'task.blocker-added',
        subject: { type: 'task', id: task.id },
        projectId: task.projectId,
        details: { blockerId: blocker.id, blockerProjectId: blocker.projectId },
      })
    })
  }

  /**
   * Makes the task no longer blocked by `blockerId`. Refused as not found if there is no such task
   * or it is not blocked by `blockerId`, as not visible to someone with no role in its project,
   * and as forbidden to someone whose role there does not allow editing the plan. The blocker's
   * own project is not asked: the relation is the task's alone.
   */
  async removeBlocker(caller: Caller, taskId: string, blockerId: unknown): Promise<TaskRelations> {
    return this.#change(caller, taskId, async (tx, task) => {
      const removed = isTaskId(blockerId)
        ? await tx
            .delete(taskBlockedBy)
            .where(and(eq(taskBlockedBy.taskId, task.id), eq(taskBlockedBy.blockerId, blockerId)))
            .returning({ blockerId: taskBlockedBy.blockerId })
        : []
      const [relation] = removed
      if (!relation) throw new ServiceError('not-found', 'The task is not blocked by that task')
      await this.#audit.record(tx, caller, {
        action: 'task.blocker-removed',
        subject: { type: 'task', id: task.id },
        projectId: task.projectId,
        details: { blockerId: relation.blockerId },
      })
    })
  }

  /**
   * Runs a change of the task's relations in one transaction: the task is looked up and the
   * caller's right to edit its project's plan checked first, so that a refusal tells nothing about
   * what was sent; then the relations lock is taken and the task read afresh, so that the change
   * is checked against the relations as they are. Answers the task's relations after the change.
   */
  async #change(
    caller: Caller,
    taskId: string,
    apply: (tx: Transaction, task: Found) => Promise<void>,
  ): Promise<TaskRelations> {
    return this.#db.transaction(async (tx) => {
      const before = await this.#find(taskId, tx)
      // A task never changes project, so the check still holds after the lock.
      await this.#roles.permissions.require(caller, before.projectId, 'edit-plan', tx)
      await lockRelations(tx)
      const task = await this.#find(taskId, tx)
      await apply(tx, task)
      return this.#relationsOf(caller, tx, await this.#find(taskId, tx))
    })
  }

  /** The task `parentId` names, as a parent of `task` must be: a task of the same project. */
  async #parent(tx: Transaction, task: Found, parentId: unknown): Promise<Found> {
    const [parent] = isTaskId(parentId) ? await select(tx, parentId) : []
    // A task of another project is answered as one that does not exist, so that the answer tells
    // nothing about another project's tasks.
    if (!parent || parent.projectId !== task.projectId) {
      throw new ServiceError('not-found', 'There is no such task in this project')
    }
    return parent
  }

  /** The task's relations as the caller may see them: blockers they cannot read left out. */
  async #relationsOf(caller: Caller, executor: Executor, task: Found): Promise<TaskRelations> {
    const relations = await relationsOf(executor, task)
    return {
      ...relations,
      blockedBy: await this.#filter.readable(caller, relations.blockedBy, executor),
    }
  }

  async #find(taskId: unknown, executor: Executor): Promise<Found> {
    const [task] = isTaskId(taskId) ? await select(executor, taskId) : []
    if (!task) throw new ServiceError('not-found', 'There is no such task')
    return task
  }
}

function select(executor: Executor, taskId: string): Promise<Found[]> {
  return executor.select(found).from(tasks).where(eq(tasks.id, taskId))
}

async function relationsOf(executor: Executor, task: Found): Promise<TaskRelations> {
  const ref = { id: tasks.id, projectId: tasks.projectId }
  const [parent] =
    task.parentId === null
      ? []
      : await executor.select(ref).from(tasks).where(eq(tasks.id, task.parentId))
  const subtasks = await executor
    .select(ref)
    .from(tasks)
    .where(eq(tasks.parentId, task.id))
    .orderBy(asc(tasks.createdAt), asc(tasks.id))
  const blockedBy = await executor
    .select(ref)
    .from(taskBlockedBy)
    .innerJoin(tasks, eq(tasks.id, taskBlockedBy.blockerId))
    .where(eq(taskBlockedBy.taskId, task.id))
    .orderBy(asc(taskBlockedBy.createdAt), asc(tasks.id))
  return { taskId: task.id, parent: parent ?? null, subtasks, blockedBy }
}

/** Whether `ancestor` is `taskId` itself, or its parent, or its parent's parent, and so on. */
async function isAncestorOrSelf(
  executor: Executor,
  ancestor: string,
  taskId: string,
): Promise<boolean> {
  const result = await executor.execute<{ found: boolean }>(sql`
    with recursive line(id) as (
      select ${taskId}::uuid
      union
      select ${tasks.parentId} from ${tasks} join line on ${tasks.id} = line.id
      where ${tasks.parentId} is not null
    )
    select exists (select 1 from line where id = ${ancestor}::uuid) as found
  `)
  return result.rows[0]?.found === true
}

/**
 * Whether `taskId` is `blockerId` itself, or blocked by it directly or through other tasks, across
 * every project: the relation "`blockerId` blocks `taskId`" would then close a cycle.
 */
async function isBlockedBy(
  executor: Executor,
  taskId: string,
  blockerId: string,
): Promise<boolean> {
  const result = await executor.execute<{ found: boolean }>(sql`
    with recursive reached(id) as (
      select ${taskId}::uuid
      union
      select ${taskBlockedBy.blockerId} from ${taskBlockedBy}
      join reached on ${taskBlockedBy.taskId} = reached.id
    )
    select exists (select 1 from reached where id = ${blockerId}::uuid) as found
  `)
  return result.rows[0]?.found === true
}

function invalid(message: string): ServiceError {
  return new ServiceError('invalid', message)
}

import { createHash } from 'node:crypto'
import { asc, inArray } from 'drizzle-orm'
import type { Executor, Transaction } from '../db/client.ts'
import { taskBlockedBy, tasks } from '../db/schema.ts'
import type { TaskAssignments } from './assignment.ts'
import type { AuditLogService } from './audit.ts'
import type { Caller } from './caller.ts'
import { ServiceError } from './errors.ts'
import type { PlanningChanges } from './planning-changes.ts'
import type { ProjectRepositoryService } from './project-repositories.ts'
import type { ProjectRoleService } from './project-roles.ts'
import type { Proposal, StoredChange, TaskRef } from './proposals.ts'
import { detectRedFlags } from './red-flags.ts'
import { TaskCancellationService } from './task-cancellation.ts'
import { TaskRelationService } from './task-relations.ts'
import { TaskRepositoryService } from './task-repository.ts'
import { TaskStatusService, type Today } from './task-status.ts'
import { type Task, taskColumns, TaskService, toTasks } from './tasks.ts'
import type { ViewReadFilter } from './view-filter.ts'

/**
 * A task as the preview shows it: the task as the service layer hands it out, with the task it is
 * a subtask of and the tasks it is blocked by, so that a proposed change of its relations shows
 * too.
 */
export type PreviewedTask = Task & {
  /** The task it is a subtask of, by id, or `null`. */
  parentId: string | null
  /** The tasks it is blocked by, by id, in the order of their ids. */
  blockedBy: string[]
}

/** What making a proposal's changes needs: the modules that make each change directly. */
export interface ApplicationContext {
  /**
   * The audit log the changes are recorded in. The preview passes the audit log itself; the
   * approval passes one that records each change as an approved proposal's (FR-139, FR-164).
   */
  audit: AuditLogService
  roles: ProjectRoleService
  filter: ViewReadFilter
  projectRepositories: ProjectRepositoryService
  today: Today
  /** Told of the tasks whose mirrored planning changed; nobody, for the preview. */
  changes?: PlanningChanges
}

/**
 * Makes each change of the proposal in the transaction, in order, through the module that makes
 * it directly, by the same rules, for the caller `callerOf` gives for the change. Refused as a
 * conflict, naming the change and why, if one of them cannot be made on the plan as it is now.
 * Answers the id each task the proposal creates was given, by its key.
 */
export async function applyChanges(
  tx: Transaction,
  proposal: Proposal,
  context: ApplicationContext,
  callerOf: (change: StoredChange) => Caller,
): Promise<Map<string, string>> {
  // The modules on the transaction: each opens its own transaction within it, as a savepoint.
  const db = tx
  const { audit, roles, changes } = context
  const make = {
    tasks: new TaskService(db, audit, roles, changes),
    relations: new TaskRelationService(db, audit, roles, context.filter, changes),
    status: new TaskStatusService(db, audit, roles, context.today),
    cancellation: new TaskCancellationService(db, audit, roles, changes),
    repository: new TaskRepositoryService(db, audit, roles, context.projectRepositories, changes),
  }
  const created = new Map<string, string>()
  const idOf = (ref: TaskRef): string => {
    if ('taskId' in ref) return ref.taskId
    const id = created.get(ref.newTask)
    // Cannot happen: the store keeps a new task's changes in the group that creates it, after it.
    if (id === undefined) throw new Error(`The new task ${ref.newTask} was not created`)
    return id
  }
  const apply = async (change: StoredChange): Promise<void> => {
    const caller = callerOf(change)
    switch (change.kind) {
      case 'create-task': {
        const task = await make.tasks.createTask(caller, change.projectId, change.fields)
        created.set(change.key, task.id)
        return
      }
      case 'update-task':
        await make.tasks.updateTask(caller, idOf(change.task), change.fields)
        return
      case 'set-parent':
        await make.relations.setParent(
          caller,
          idOf(change.task),
          change.parent === null ? null : idOf(change.parent),
        )
        return
      case 'add-blocker':
        await make.relations.addBlocker(caller, idOf(change.task), idOf(change.blocker))
        return
      case 'remove-blocker':
        await make.relations.removeBlocker(caller, idOf(change.task), idOf(change.blocker))
        return
      case 'set-status':
        await make.status.setStatus(caller, idOf(change.task), change.status)
        return
      case 'cancel-task':
        await make.cancellation.cancel(caller, idOf(change.task))
        return
      case 'assign-repository':
        await make.repository.assignRepository(caller, idOf(change.task), change.repositoryId)
        return
    }
  }
  for (const [g, group] of proposal.groups.entries()) {
    for (const [c, change] of group.changes.entries()) {
      try {
        await apply(change)
      } catch (error) {
        if (!(error instanceof ServiceError)) throw error
        throw new ServiceError(
          'conflict',
          `Change ${c + 1} of group ${g + 1} of the proposal cannot be made on the plan as ` +
            `it is now: ${error.message}`,
        )
      }
    }
  }
  return created
}

/**
 * The version of the plan a proposal is previewed and approved against (FR-077, FR-078): a digest
 * of the proposal as it was last edited, the tasks of the projects it changes, with their
 * relations, and the red flags raised in those projects. Any change to one of these gives another
 * version; reading the same plan gives the same one.
 */
export async function planVersion(
  executor: Executor,
  assignments: TaskAssignments,
  proposal: Proposal,
): Promise<string> {
  const projectIds = new Set(proposal.projectIds)
  const plan = await readTasks(executor, assignments, proposal.projectIds)
  const flags = (await detectRedFlags(executor))
    .filter((flag) => projectIds.has(flag.projectId))
    .map((flag) => JSON.stringify([flag.projectId, flag.key, flag.detail]))
    .sort()
  const content = JSON.stringify({
    proposal: { lastEditedAt: proposal.lastEditedAt.toISOString(), groups: proposal.groups },
    tasks: [...plan.values()],
    flags,
  })
  return createHash('sha256').update(content).digest('hex')
}

/** The tasks of the projects, in the order they were created, each with its relations. */
export async function readTasks(
  executor: Executor,
  assignments: TaskAssignments,
  projectIds: readonly string[],
): Promise<Map<string, PreviewedTask>> {
  if (projectIds.length === 0) return new Map()
  const rows = await executor
    .select({ ...taskColumns, parentId: tasks.parentId })
    .from(tasks)
    .where(inArray(tasks.projectId, [...projectIds]))
    .orderBy(asc(tasks.createdAt), asc(tasks.id))
  const ids = rows.map((row) => row.id)
  const relations =
    ids.length === 0
      ? []
      : await executor
          .select({ taskId: taskBlockedBy.taskId, blockerId: taskBlockedBy.blockerId })
          .from(taskBlockedBy)
          .where(inArray(taskBlockedBy.taskId, ids))
          .orderBy(asc(taskBlockedBy.blockerId))
  const blockedBy = new Map<string, string[]>()
  for (const { taskId, blockerId } of relations) {
    const list = blockedBy.get(taskId)
    if (list) list.push(blockerId)
    else blockedBy.set(taskId, [blockerId])
  }
  const parentOf = new Map(rows.map((row) => [row.id, row.parentId]))
  const result = new Map<string, PreviewedTask>()
  for (const projectId of projectIds) {
    const own = rows
      .filter((row) => row.projectId === projectId)
      .map(({ parentId: _parentId, ...row }) => row)
    for (const task of await toTasks(assignments, executor, projectId, own)) {
      result.set(task.id, {
        ...task,
        parentId: parentOf.get(task.id) ?? null,
        blockedBy: blockedBy.get(task.id) ?? [],
      })
    }
  }
  // Back in the order the tasks were created, across the projects.
  const ordered = new Map<string, PreviewedTask>()
  for (const id of ids) {
    const task = result.get(id)
    if (task) ordered.set(id, task)
  }
  return ordered
}

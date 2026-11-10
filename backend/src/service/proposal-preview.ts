import { asc, inArray } from 'drizzle-orm'
import type { Database, Executor, Transaction } from '../db/client.ts'
import { taskBlockedBy, tasks } from '../db/schema.ts'
import { TaskAssignments } from './assignment.ts'
import type { AuditLogService } from './audit.ts'
import type { Caller } from './caller.ts'
import { ServiceError } from './errors.ts'
import type { ProjectRepositoryService } from './project-repositories.ts'
import type { ProjectRoleService } from './project-roles.ts'
import type { Proposal, ProposalService, StoredChange, TaskRef } from './proposals.ts'
import { detectRedFlags, type FoundFlag } from './red-flags.ts'
import { TaskCancellationService } from './task-cancellation.ts'
import { TaskRelationService } from './task-relations.ts'
import { TaskRepositoryService } from './task-repository.ts'
import { localToday, TaskStatusService, type Today } from './task-status.ts'
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

/**
 * A task the proposal would change: how it is in the live plan and how it would be once the
 * proposal's changes were made. A task the proposal creates has no `before`, and its id is the
 * one it has in this preview only: it names the task within the preview, nowhere else.
 */
export interface TaskDifference {
  taskId: string
  projectId: string
  /** The key the proposal gives a task it creates; `null` for a task of the live plan. */
  newTask: string | null
  before: PreviewedTask | null
  after: PreviewedTask
}

/**
 * The live preview of a proposal against the current plan (FR-072, DD-021): what making its
 * changes now would do to the projects it changes.
 */
export interface ProposalPreview {
  proposalId: string
  /**
   * Each task of the projects the proposal changes that its changes, or the rescheduling they
   * cause, would change, in the order the tasks were created.
   */
  differences: TaskDifference[]
  /**
   * Each red flag its changes would raise in a project it changes that the current plan does not
   * raise there (DD-029); one across a project boundary only if the caller can read both projects.
   */
  newRedFlags: FoundFlag[]
}

/** Thrown to roll the preview's transaction back once the preview has been read. */
class PreviewDone extends Error {}

/**
 * The proposal preview of the service layer (SC-011, DD-039). It applies a proposal's changes to
 * a copy of the live plan, has the scheduler reschedule it (DD-046), and answers the differences
 * and the new red flags (FR-072, DD-021), as they are against the plan as it is when it is asked.
 *
 * The copy is a database transaction that is always rolled back: each change is made in it by the
 * same service that makes the change directly, by the same rules, rescheduling and red flag
 * detection included, so the preview shows what approving it now would do. Nothing the preview
 * does is ever committed, so the live plan, its red flags and the audit log are left as they were
 * (FR-071), and nothing reaches GitHub. The proposal itself is only read: its changes are never
 * rewritten to fit the current plan; recomputing the preview is the only adjustment made (FR-079).
 *
 * The changes are made for the proposal's creator, through the channel it was created through, as
 * they would be if its creator made them directly. Anyone who may read the proposal may preview it
 * (FR-106).
 */
export class ProposalPreviewService {
  readonly #db: Database
  readonly #proposals: ProposalService
  readonly #audit: AuditLogService
  readonly #roles: ProjectRoleService
  readonly #filter: ViewReadFilter
  readonly #projectRepositories: ProjectRepositoryService
  readonly #today: Today
  readonly #assignments: TaskAssignments

  constructor(
    db: Database,
    proposals: ProposalService,
    audit: AuditLogService,
    roles: ProjectRoleService,
    filter: ViewReadFilter,
    projectRepositories: ProjectRepositoryService,
    today: Today = localToday,
  ) {
    this.#db = db
    this.#proposals = proposals
    this.#audit = audit
    this.#roles = roles
    this.#filter = filter
    this.#projectRepositories = projectRepositories
    this.#today = today
    this.#assignments = new TaskAssignments(roles)
  }

  /**
   * The live preview of the proposal. Refused as the proposal store refuses to read it (not found,
   * not visible); and as a conflict if one of its changes cannot be made on the plan as it is now,
   * naming the change and why, by the rules of the change made directly.
   */
  async previewProposal(caller: Caller, proposalId: string): Promise<ProposalPreview> {
    const proposal = await this.#proposals.getProposal(caller, proposalId)
    let preview: ProposalPreview | undefined
    try {
      await this.#db.transaction(async (tx) => {
        preview = await this.#preview(caller, tx, proposal)
        throw new PreviewDone()
      })
    } catch (error) {
      if (!(error instanceof PreviewDone)) throw error
    }
    if (!preview) throw new Error('The preview was not computed')
    return preview
  }

  async #preview(caller: Caller, tx: Transaction, proposal: Proposal): Promise<ProposalPreview> {
    const projectIds = proposal.projectIds
    const before = await readTasks(tx, this.#assignments, projectIds)
    const flagsBefore = await detectRedFlags(tx)
    const created = await this.#apply(tx, proposal)
    const after = await readTasks(tx, this.#assignments, projectIds)
    const flagsAfter = await detectRedFlags(tx)

    const keyOf = new Map([...created].map(([key, id]) => [id, key]))
    const differences: TaskDifference[] = []
    for (const task of after.values()) {
      const previous = before.get(task.id) ?? null
      if (previous && JSON.stringify(previous) === JSON.stringify(task)) continue
      differences.push({
        taskId: task.id,
        projectId: task.projectId,
        newTask: keyOf.get(task.id) ?? null,
        before: previous,
        after: task,
      })
    }

    const identity = (flag: FoundFlag) => `${flag.projectId} ${flag.key}`
    const raised = new Set(flagsBefore.map(identity))
    const changed = new Set(projectIds)
    const readable = await this.#roles.readableProjects(caller.accountId, tx)
    const newRedFlags = flagsAfter.filter(
      (flag) =>
        changed.has(flag.projectId) &&
        !raised.has(identity(flag)) &&
        (!('blocker' in flag.detail) ||
          !flag.detail.crossProject ||
          (readable.has(flag.detail.task.projectId) &&
            readable.has(flag.detail.blocker.projectId))),
    )
    return { proposalId: proposal.id, differences, newRedFlags }
  }

  /**
   * Makes each change of the proposal in the transaction, in order, through the service that makes
   * it directly. Answers the id each task the proposal creates was given, by its key.
   */
  async #apply(tx: Transaction, proposal: Proposal): Promise<Map<string, string>> {
    // The services on the transaction: each opens its own transaction within it, as a savepoint.
    const db = tx
    const audit = this.#audit
    const roles = this.#roles
    const make = {
      tasks: new TaskService(db, audit, roles),
      relations: new TaskRelationService(db, audit, roles, this.#filter),
      status: new TaskStatusService(db, audit, roles, this.#today),
      cancellation: new TaskCancellationService(db, audit, roles),
      repository: new TaskRepositoryService(db, audit, roles, this.#projectRepositories),
    }
    const creator: Caller = { accountId: proposal.createdBy, channel: proposal.channel }
    const created = new Map<string, string>()
    const idOf = (ref: TaskRef): string => {
      if ('taskId' in ref) return ref.taskId
      const id = created.get(ref.newTask)
      // Cannot happen: the store keeps a new task's changes in the group that creates it, after it.
      if (id === undefined) throw new Error(`The new task ${ref.newTask} was not created`)
      return id
    }
    const apply = async (change: StoredChange): Promise<void> => {
      switch (change.kind) {
        case 'create-task': {
          const task = await make.tasks.createTask(creator, change.projectId, change.fields)
          created.set(change.key, task.id)
          return
        }
        case 'update-task':
          await make.tasks.updateTask(creator, idOf(change.task), change.fields)
          return
        case 'set-parent':
          await make.relations.setParent(
            creator,
            idOf(change.task),
            change.parent === null ? null : idOf(change.parent),
          )
          return
        case 'add-blocker':
          await make.relations.addBlocker(creator, idOf(change.task), idOf(change.blocker))
          return
        case 'remove-blocker':
          await make.relations.removeBlocker(creator, idOf(change.task), idOf(change.blocker))
          return
        case 'set-status':
          await make.status.setStatus(creator, idOf(change.task), change.status)
          return
        case 'cancel-task':
          await make.cancellation.cancel(creator, idOf(change.task))
          return
        case 'assign-repository':
          await make.repository.assignRepository(creator, idOf(change.task), change.repositoryId)
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
}

/** The tasks of the projects, in the order they were created, each with its relations. */
async function readTasks(
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

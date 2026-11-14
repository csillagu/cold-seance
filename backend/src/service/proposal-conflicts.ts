import { and, asc, eq, inArray, sql } from 'drizzle-orm'
import type { Database } from '../db/client.ts'
import { auditLog, proposalChanges, proposalGroups, tasks } from '../db/schema.ts'
import type { Caller } from './caller.ts'
import type { ProposalService, StoredChange } from './proposals.ts'

/**
 * Why a change conflicts (DD-022): someone else edited one of the inputs it changes on its task
 * after it was given, or its task was deleted.
 */
export type ConflictReason = 'edited' | 'deleted'

/** A change of a proposal that conflicts with the live plan, for the reviewer to resolve or drop. */
export interface ProposalConflict {
  /** The group the change is in, which is resolved (edited) or dropped as one (DD-023). */
  groupId: string
  changeId: string
  /** The existing task the change changes. */
  taskId: string
  reason: ConflictReason
  /**
   * The inputs of the change that someone else edited, named as the change names them: a field it
   * gives (`plannedStart`, `personLoad`, ...), or `parent`, `blocker`, `status` or `repository`.
   * Empty for a deleted task.
   */
  inputs: string[]
}

/** A proposal's conflicts, in the order of its groups and of the changes in each. */
export interface ProposalConflicts {
  proposalId: string
  conflicts: ProposalConflict[]
}

/**
 * An input of a change, as the change names it, with the keys that `editedKeys` gives an edit of
 * it.
 */
interface ChangedInput {
  name: string
  keys: string[]
}

/** The task fields a proposal gives under another name than the audit log records them by. */
const FIELD_KEYS: Readonly<Record<string, string[]>> = {
  personLoad: ['aiOnlyLoad'],
  milestone: ['milestoneVariant', 'milestoneDate'],
}

/**
 * The inputs of its existing task that a change changes. A change that creates a task, or whose
 * task is one the proposal creates, changes no input anyone else can have edited.
 */
export function changedInputs(change: StoredChange): ChangedInput[] {
  if (change.kind === 'create-task' || !('taskId' in change.task)) return []
  switch (change.kind) {
    case 'update-task':
      return Object.keys(change.fields).map((name) => ({
        name,
        keys: FIELD_KEYS[name] ?? [name],
      }))
    case 'set-parent':
      return [{ name: 'parent', keys: ['parent'] }]
    case 'add-blocker':
    case 'remove-blocker':
      // The relation with that blocker; one with a task the proposal creates exists nowhere else.
      return 'taskId' in change.blocker
        ? [{ name: 'blocker', keys: [`blocker:${change.blocker.taskId}`] }]
        : []
    case 'set-status':
    case 'cancel-task':
      return [{ name: 'status', keys: ['status'] }]
    case 'assign-repository':
      return [{ name: 'repository', keys: ['repository'] }]
    default:
      return []
  }
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const strings = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((item) => typeof item === 'string') : []

/**
 * The inputs of a task that an entry of the audit log records as edited, by the keys
 * `changedInputs` gives. A rescheduling is not an edit of an input: it moves the dates the
 * scheduler derives (DD-022, DD-020), so it, like any entry that edits no input, gives none.
 */
export function editedKeys(action: string, details: Record<string, unknown>): string[] {
  switch (action) {
    case 'task.updated':
      return isObject(details.changes) ? Object.keys(details.changes) : []
    case 'task.parent-set':
      return ['parent']
    case 'task.blocker-added':
    case 'task.blocker-removed':
      return typeof details.blockerId === 'string' ? [`blocker:${details.blockerId}`] : []
    case 'task.blockers-passed-on':
      return [details.cancelledTaskId, ...strings(details.addedBlockerIds)]
        .filter((id) => typeof id === 'string')
        .map((id) => `blocker:${id}`)
    case 'task.status-set':
    case 'task.cancelled':
      return ['status']
    case 'task.repository-assigned':
      return ['repository']
    default:
      return []
  }
}

/**
 * The proposal conflict detector of the service layer (SC-047, DD-039). It marks as a conflict
 * each change of a proposal whose input on the same task was edited by someone other than the
 * proposal's creator after the change was given, or whose task was deleted (FR-076, DD-022), and
 * nothing else: an edit of another input of the task, or a change of the dates the scheduler
 * derives, is no conflict.
 *
 * The edits are read from the audit log, which records every change to a task with who made it,
 * when, and what it changed (FR-116). A change is given when the proposal is created, and again
 * when its group is edited (SC-045), so editing the group resolves its conflicts. The proposal and
 * the plan are only read. Anyone who may read the proposal may read its conflicts (FR-106).
 */
export class ProposalConflictService {
  readonly #db: Database
  readonly #proposals: ProposalService

  constructor(db: Database, proposals: ProposalService) {
    this.#db = db
    this.#proposals = proposals
  }

  /**
   * The proposal's conflicts. Refused as the proposal store refuses to read the proposal (not
   * found, not visible).
   */
  async conflictsOf(caller: Caller, proposalId: string): Promise<ProposalConflicts> {
    const proposal = await this.#proposals.getProposal(caller, proposalId)
    const changes = proposal.groups.flatMap((group) =>
      group.changes.map((change) => ({ groupId: group.id, change })),
    )
    const taskIds = [
      ...new Set(
        changes.flatMap(({ change }) =>
          change.kind !== 'create-task' && 'taskId' in change.task ? [change.task.taskId] : [],
        ),
      ),
    ]
    if (taskIds.length === 0) return { proposalId, conflicts: [] }

    const existing = await this.#db
      .select({ id: tasks.id })
      .from(tasks)
      .where(inArray(tasks.id, taskIds))
    const exists = new Set(existing.map((row) => row.id))

    // Compared in the database, at its precision: the audit log's time and the change's are both
    // the time of the transaction that wrote them.
    const edits = await this.#db
      .select({
        changeId: proposalChanges.id,
        action: auditLog.action,
        details: auditLog.details,
      })
      .from(proposalChanges)
      .innerJoin(proposalGroups, eq(proposalGroups.id, proposalChanges.groupId))
      .innerJoin(
        auditLog,
        and(
          eq(auditLog.subjectType, 'task'),
          sql`${auditLog.subjectId} = ${proposalChanges.taskId}::text`,
          sql`${auditLog.at} > ${proposalChanges.givenAt}`,
        ),
      )
      .where(
        and(
          eq(proposalGroups.proposalId, proposalId),
          // A change made on GitHub has no account, and is never the proposal creator's own.
          sql`${auditLog.actorAccountId} is distinct from ${proposal.createdBy}::uuid`,
        ),
      )
      .orderBy(asc(auditLog.id))
    const edited = new Map<string, Set<string>>()
    for (const edit of edits) {
      const keys = edited.get(edit.changeId) ?? new Set<string>()
      for (const key of editedKeys(edit.action, edit.details)) keys.add(key)
      edited.set(edit.changeId, keys)
    }

    const conflicts: ProposalConflict[] = []
    for (const { groupId, change } of changes) {
      if (change.kind === 'create-task' || !('taskId' in change.task)) continue
      const taskId = change.task.taskId
      if (!exists.has(taskId)) {
        conflicts.push({ groupId, changeId: change.id, taskId, reason: 'deleted', inputs: [] })
        continue
      }
      const keys = edited.get(change.id)
      if (!keys) continue
      const inputs = changedInputs(change)
        .filter((input) => input.keys.some((key) => keys.has(key)))
        .map((input) => input.name)
      if (inputs.length > 0) {
        conflicts.push({ groupId, changeId: change.id, taskId, reason: 'edited', inputs })
      }
    }
    return { proposalId, conflicts }
  }
}

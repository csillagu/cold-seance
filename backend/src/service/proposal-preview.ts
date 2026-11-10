import type { Database, Transaction } from '../db/client.ts'
import { TaskAssignments } from './assignment.ts'
import type { AuditLogService } from './audit.ts'
import type { Caller } from './caller.ts'
import { applyChanges, planVersion, type PreviewedTask, readTasks } from './proposal-application.ts'
import type { ProjectRepositoryService } from './project-repositories.ts'
import type { ProjectRoleService } from './project-roles.ts'
import type { Proposal, ProposalService } from './proposals.ts'
import { detectRedFlags, type FoundFlag } from './red-flags.ts'
import { localToday, type Today } from './task-status.ts'
import type { ViewReadFilter } from './view-filter.ts'

export type { PreviewedTask }

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
   * The version of the plan the preview was made against (FR-077, FR-078). An approval names it,
   * and is asked to confirm again with a new preview if the plan is no longer at that version.
   */
  planVersion: string
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
    const version = await planVersion(tx, this.#assignments, proposal)
    const before = await readTasks(tx, this.#assignments, projectIds)
    const flagsBefore = await detectRedFlags(tx)
    const creator: Caller = { accountId: proposal.createdBy, channel: proposal.channel }
    const created = await applyChanges(
      tx,
      proposal,
      {
        audit: this.#audit,
        roles: this.#roles,
        filter: this.#filter,
        projectRepositories: this.#projectRepositories,
        today: this.#today,
      },
      () => creator,
    )
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
    return { proposalId: proposal.id, planVersion: version, differences, newRedFlags }
  }
}

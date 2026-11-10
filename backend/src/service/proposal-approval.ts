import { eq, sql } from 'drizzle-orm'
import type { Database, Executor } from '../db/client.ts'
import { proposalApprovals, proposals } from '../db/schema.ts'
import { TaskAssignments } from './assignment.ts'
import { AuditLogService, type Change } from './audit.ts'
import type { Caller, Channel } from './caller.ts'
import { ServiceError } from './errors.ts'
import { NO_PLANNING_CHANGES, type PlanningChanges } from './planning-changes.ts'
import type { ProjectRepositoryService } from './project-repositories.ts'
import type { ProjectRoleService } from './project-roles.ts'
import { applyChanges, planVersion } from './proposal-application.ts'
import type { ProposalPreview, ProposalPreviewService } from './proposal-preview.ts'
import { currentApprovals, type Proposal, type ProposalService } from './proposals.ts'
import { isUuid } from './system-admins.ts'
import { localToday, type Today } from './task-status.ts'
import type { ViewReadFilter } from './view-filter.ts'

/** An approval as a channel hands it over, each value still unchecked. */
export interface ApprovalInput {
  /** The project whose part of the proposal is approved (FR-080, DD-025). */
  readonly projectId?: unknown
  /**
   * The version of the plan the reviewer's preview was made against (`ProposalPreview`); left
   * out by a reviewer who has seen no preview.
   */
  readonly planVersion?: unknown
}

/**
 * What an approval did:
 *
 * - `confirm-again`: the plan is not at the version the reviewer saw, or they saw none, so
 *   nothing was approved; `preview` is the preview against the plan as it is now, to confirm
 *   with its `planVersion` (FR-078).
 * - `waiting-for-parts`: the project's part was approved; other projects' parts still wait for
 *   their approval, and nothing is applied until they have it (FR-132).
 * - `applied`: the part was approved, every part now is, and all the changes were applied
 *   (FR-077).
 */
export type ApprovalResult =
  | { outcome: 'confirm-again'; proposal: Proposal; preview: ProposalPreview }
  | { outcome: 'waiting-for-parts' | 'applied'; proposal: Proposal }

/**
 * Records each change an approved proposal applies as the approver's, through both the
 * proposal's channel and the approval's (FR-139, FR-164), in place of the caller's own channel.
 */
class ApprovedProposalAudit extends AuditLogService {
  readonly #proposalChannel: Channel

  constructor(db: Database, roles: ProjectRoleService, proposalChannel: Channel) {
    super(db, roles)
    this.#proposalChannel = proposalChannel
  }

  override async record(executor: Executor, caller: Caller, change: Change): Promise<void> {
    await this.recordApprovedProposalChange(executor, caller, this.#proposalChannel, change)
  }
}

/** Ends the approval's transaction without recording anything, to ask for a new confirmation. */
class ConfirmAgain extends Error {}

const invalid = (message: string) => new ServiceError('invalid', message)

/**
 * The proposal approval of the service layer (SC-048, DD-039). Someone with the read-write or
 * admin role in a project the proposal changes approves that project's part of it (FR-080,
 * DD-025), against the version of the plan their preview was made against (SC-011). If the plan
 * is no longer at that version, nothing is approved, and the approval answers the preview
 * against the plan as it is now, for the reviewer to confirm again (FR-078).
 *
 * Once every project's part is approved, the last approval applies all of the proposal's changes
 * in its one transaction, or none of them (FR-077, FR-132): each change is made by the module that
 * makes it directly, by the same rules, for the person who approved its project's part, and
 * recorded in the audit log as theirs, through both the proposal's channel and the approval's
 * (FR-139, FR-164). If one change cannot be made, the approval is refused, naming it, and nothing
 * of it is kept: no change, and not the approval itself. The GitHub planning mirror is told of the
 * changed tasks once they are committed.
 *
 * An approval counts only while the proposal is as it was when it was given: an edit of the
 * proposal (SC-045) asks for every part to be approved again. A proposal that was approved,
 * rejected or has expired (SC-046) can no longer be approved. Each approval is recorded in the
 * audit log in the part's project, and the application in each project the proposal changes.
 */
export class ProposalApprovalService {
  readonly #db: Database
  readonly #audit: AuditLogService
  readonly #roles: ProjectRoleService
  readonly #proposals: ProposalService
  readonly #preview: ProposalPreviewService
  readonly #filter: ViewReadFilter
  readonly #projectRepositories: ProjectRepositoryService
  readonly #changes: PlanningChanges
  readonly #today: Today
  readonly #now: () => Date
  readonly #assignments: TaskAssignments

  constructor(
    db: Database,
    audit: AuditLogService,
    roles: ProjectRoleService,
    proposalStore: ProposalService,
    preview: ProposalPreviewService,
    filter: ViewReadFilter,
    projectRepositories: ProjectRepositoryService,
    options: { changes?: PlanningChanges; today?: Today; now?: () => Date } = {},
  ) {
    this.#db = db
    this.#audit = audit
    this.#roles = roles
    this.#proposals = proposalStore
    this.#preview = preview
    this.#filter = filter
    this.#projectRepositories = projectRepositories
    this.#changes = options.changes ?? NO_PLANNING_CHANGES
    this.#today = options.today ?? localToday
    this.#now = options.now ?? (() => new Date())
    this.#assignments = new TaskAssignments(roles)
  }

  /**
   * Approves the part of the proposal that changes the project `input.projectId`, against the
   * plan version `input.planVersion`, and applies the proposal once every part is approved.
   * Refused as invalid without a project the proposal changes, or with a plan version that is not
   * text; as the proposal store refuses to read the proposal (not found, not visible); as
   * forbidden without the read-write or admin role in that project; as a conflict if the proposal
   * was approved, is rejected or has expired, or if one of its changes cannot be made on the plan
   * as it is now, naming the change and why.
   */
  async approve(caller: Caller, proposalId: string, input: ApprovalInput): Promise<ApprovalResult> {
    const { projectId, planVersion: seen } = input
    if (typeof projectId !== 'string' || !isUuid(projectId)) {
      throw invalid('Name the project whose part of the proposal is approved')
    }
    if (seen !== undefined && seen !== null && typeof seen !== 'string') {
      throw invalid('The plan version is the one a preview of the proposal gives')
    }
    const changed: string[] = []
    let applied = false
    try {
      await this.#db.transaction(async (tx) => {
        // Locked for the rest of the transaction, so that an edit, a rejection or another
        // approval of the proposal is made before or after this one, never during it.
        if (!isUuid(proposalId)) throw new ServiceError('not-found', 'There is no such proposal')
        await tx
          .select({ id: proposals.id })
          .from(proposals)
          .where(eq(proposals.id, proposalId))
          .for('update')
        const proposal = await this.#proposals.getProposal(caller, proposalId, tx)
        if (!proposal.projectIds.includes(projectId)) {
          throw invalid('The proposal does not change that project')
        }
        await this.#roles.permissions.require(caller, projectId, 'handle-proposals', tx)
        if (proposal.status === 'approved') {
          throw new ServiceError('conflict', 'The proposal was already approved and applied')
        }
        if (proposal.status === 'rejected') {
          throw new ServiceError('conflict', 'The proposal was rejected')
        }
        if (proposal.status === 'expired') {
          throw new ServiceError(
            'conflict',
            'The proposal has expired: no one edited it for 24 hours',
          )
        }
        if (seen !== (await planVersion(tx, this.#assignments, proposal))) throw new ConfirmAgain()

        const now = this.#now()
        await tx
          .insert(proposalApprovals)
          .values({
            proposalId,
            projectId,
            approvedBy: caller.accountId,
            channel: caller.channel,
            approvedAt: now,
            proposalEditedAt: sql`(select ${proposals.lastEditedAt} from ${proposals} where ${proposals.id} = ${proposalId})`,
          })
          .onConflictDoUpdate({
            target: [proposalApprovals.proposalId, proposalApprovals.projectId],
            set: {
              approvedBy: caller.accountId,
              channel: caller.channel,
              approvedAt: now,
              proposalEditedAt: sql`excluded.proposal_edited_at`,
            },
          })
        await this.#audit.record(tx, caller, {
          action: 'proposal.part-approved',
          subject: { type: 'proposal', id: proposalId },
          projectId,
        })

        const approverOf = new Map<string, Caller>(
          (await currentApprovals(tx, proposalId)).map((approval) => [
            approval.projectId,
            { accountId: approval.approvedBy, channel: approval.channel },
          ]),
        )
        if (!proposal.projectIds.every((id) => approverOf.has(id))) return

        await applyChanges(
          tx,
          proposal,
          {
            audit: new ApprovedProposalAudit(this.#db, this.#roles, proposal.channel),
            roles: this.#roles,
            filter: this.#filter,
            projectRepositories: this.#projectRepositories,
            today: this.#today,
            changes: { changed: (taskIds) => changed.push(...taskIds) },
          },
          (change) => {
            const approver = approverOf.get(change.projectId)
            if (!approver) throw new Error('A part of the proposal was not approved')
            return approver
          },
        )
        await tx.update(proposals).set({ appliedAt: now }).where(eq(proposals.id, proposalId))
        for (const id of proposal.projectIds) {
          await this.#audit.record(tx, caller, {
            action: 'proposal.applied',
            subject: { type: 'proposal', id: proposalId },
            projectId: id,
          })
        }
        applied = true
      })
    } catch (error) {
      if (!(error instanceof ConfirmAgain)) throw error
      const preview = await this.#preview.previewProposal(caller, proposalId)
      const proposal = await this.#proposals.getProposal(caller, proposalId)
      return { outcome: 'confirm-again', proposal, preview }
    }
    if (changed.length > 0) this.#changes.changed([...new Set(changed)])
    const proposal = await this.#proposals.getProposal(caller, proposalId)
    return { outcome: applied ? 'applied' : 'waiting-for-parts', proposal }
  }
}

import { and, asc, eq } from 'drizzle-orm'
import type { Database, Transaction } from '../db/client.ts'
import { proposalChanges, proposalGroups, proposalProjects, proposals } from '../db/schema.ts'
import type { AuditLogService } from './audit.ts'
import type { Caller } from './caller.ts'
import { notVisible, ServiceError } from './errors.ts'
import { allows } from './permissions.ts'
import type { ProjectRoleService } from './project-roles.ts'
import {
  insertChanges,
  locate,
  type Proposal,
  type ProposalService,
  proposalStatus,
  projectsOf,
  validGroups,
} from './proposals.ts'
import { isUuid } from './system-admins.ts'

/** A group's new changes as a channel hands them over, each value still unchecked. */
export interface GroupInput {
  readonly changes?: unknown
}

/** Why an edit or a rejection is refused to someone whose role does not allow it. */
const ROLE_REFUSAL =
  "Only the project's read-write members and admins can edit or reject a proposal that changes it"

const noProposal = () => new ServiceError('not-found', 'There is no such proposal')

const noGroup = () => new ServiceError('not-found', 'The proposal has no such group of changes')

/**
 * The edit and reject actions on a proposal (SC-045, DD-039). Someone with the read-write or admin
 * role edits a proposal one group of changes as a whole (FR-074, DD-023): they replace the
 * group's changes, or drop the group; a single change is never edited or dropped on its own. Or
 * they reject the whole proposal (FR-075), after which nothing in it can reach the plan.
 *
 * Each needs the read-write or admin role in every project the edited group changes, before and
 * after the edit, or, to reject, in every project the proposal changes; and a role in every
 * project it changes, to see it at all (FR-106). An edit restarts the proposal's 24 hours (DD-024,
 * SRC-158); a proposal that is rejected or has expired (SC-046) can no longer be edited or
 * rejected. Nothing here changes the plan. Each action is recorded in the audit log, in each
 * project it touches (FR-116).
 */
export class ProposalEditService {
  readonly #db: Database
  readonly #audit: AuditLogService
  readonly #roles: ProjectRoleService
  readonly #proposals: ProposalService
  readonly #now: () => Date

  constructor(
    db: Database,
    audit: AuditLogService,
    roles: ProjectRoleService,
    proposalStore: ProposalService,
    now: () => Date = () => new Date(),
  ) {
    this.#db = db
    this.#audit = audit
    this.#roles = roles
    this.#proposals = proposalStore
    this.#now = now
  }

  /**
   * Replaces the changes of the proposal's group with `input.changes`, as one (FR-074, DD-023),
   * checked as a new proposal's are (`validGroups`). A new task's key must not be one another
   * group already gives. Refused as not found for no such proposal or group, as a conflict if the
   * proposal is rejected or expired, and as forbidden without the read-write or admin role in a
   * project the group changes, before or after.
   */
  async editGroup(
    caller: Caller,
    proposalId: string,
    groupId: string,
    input: GroupInput,
  ): Promise<Proposal> {
    if (!Array.isArray(input.changes) || input.changes.length === 0) {
      throw new ServiceError('invalid', 'A group needs at least one change')
    }
    const [changes = []] = validGroups([{ changes: input.changes }])
    await this.#db.transaction(async (tx) => {
      await this.#open(tx, caller, proposalId)
      const group = await groupOf(tx, proposalId, groupId)
      const otherKeys = await newTaskKeys(tx, proposalId, groupId)
      for (const change of changes) {
        if (change.kind === 'create-task' && otherKeys.has(change.key)) {
          throw new ServiceError(
            'invalid',
            `Another group of the proposal already creates a new task with the key ${change.key}`,
          )
        }
      }
      const [located = []] = await locate(tx, [changes])
      const before = await projectsOfGroup(tx, group.id)
      const after = located.map((change) => change.projectId)
      const touched = [...new Set([...before, ...after])].sort()
      await this.#requireEditor(tx, caller, touched)
      for (const projectId of new Set(located.flatMap((change) => change.reads))) {
        await this.#roles.permissions.require(caller, projectId, 'read', tx)
      }
      await tx.delete(proposalChanges).where(eq(proposalChanges.groupId, group.id))
      await insertChanges(tx, group.id, located)
      await this.#touch(tx, proposalId)
      for (const projectId of touched) {
        await this.#audit.record(tx, caller, {
          action: 'proposal.edited',
          subject: { type: 'proposal', id: proposalId },
          projectId,
          details: {
            group: group.id,
            changes: after.filter((id) => id === projectId).length,
          },
        })
      }
    })
    return this.#proposals.getProposal(caller, proposalId)
  }

  /**
   * Drops the proposal's group, every change in it as one (FR-070, DD-023). Refused as invalid for
   * the proposal's only group, which is rejected instead; otherwise as `editGroup` is.
   */
  async dropGroup(caller: Caller, proposalId: string, groupId: string): Promise<Proposal> {
    await this.#db.transaction(async (tx) => {
      await this.#open(tx, caller, proposalId)
      const group = await groupOf(tx, proposalId, groupId)
      const touched = await projectsOfGroup(tx, group.id)
      await this.#requireEditor(tx, caller, touched)
      const groups = await tx
        .select({ id: proposalGroups.id })
        .from(proposalGroups)
        .where(eq(proposalGroups.proposalId, proposalId))
      if (groups.length === 1) {
        throw new ServiceError(
          'invalid',
          'A proposal keeps at least one group of changes; reject the proposal instead',
        )
      }
      await tx.delete(proposalChanges).where(eq(proposalChanges.groupId, group.id))
      await tx.delete(proposalGroups).where(eq(proposalGroups.id, group.id))
      await this.#touch(tx, proposalId)
      for (const projectId of touched) {
        await this.#audit.record(tx, caller, {
          action: 'proposal.group-dropped',
          subject: { type: 'proposal', id: proposalId },
          projectId,
          details: { group: group.id },
        })
      }
    })
    return this.#proposals.getProposal(caller, proposalId)
  }

  /**
   * Rejects the proposal (FR-075): it is no longer waiting for review, and nothing in it can be
   * approved. Refused as not found for no such proposal, as a conflict if it is already rejected
   * or has expired, and as forbidden without the read-write or admin role in every project it
   * changes.
   */
  async rejectProposal(caller: Caller, proposalId: string): Promise<Proposal> {
    await this.#db.transaction(async (tx) => {
      const projectIds = await this.#open(tx, caller, proposalId)
      await this.#requireEditor(tx, caller, projectIds)
      await tx
        .update(proposals)
        .set({ rejectedAt: this.#now(), rejectedBy: caller.accountId })
        .where(eq(proposals.id, proposalId))
      for (const projectId of projectIds) {
        await this.#audit.record(tx, caller, {
          action: 'proposal.rejected',
          subject: { type: 'proposal', id: proposalId },
          projectId,
        })
      }
    })
    return this.#proposals.getProposal(caller, proposalId)
  }

  /**
   * Locks the proposal for the rest of the transaction, so that two edits or an edit and a
   * rejection are made one after the other, and returns the projects it changes. Refused as not
   * found, as not visible to someone with no role in one of its projects (FR-017), and as a
   * conflict if it is rejected or has expired (SC-046).
   */
  async #open(tx: Transaction, caller: Caller, proposalId: string): Promise<string[]> {
    if (!isUuid(proposalId)) throw noProposal()
    const [proposal] = await tx
      .select({ lastEditedAt: proposals.lastEditedAt, rejectedAt: proposals.rejectedAt })
      .from(proposals)
      .where(eq(proposals.id, proposalId))
      .for('update')
    if (!proposal) throw noProposal()
    const projectIds = (await projectsOf(tx, [proposalId])).map((row) => row.projectId)
    for (const projectId of projectIds) {
      await this.#roles.permissions.require(caller, projectId, 'read', tx)
    }
    const status = proposalStatus(proposal, this.#now())
    if (status === 'rejected') {
      throw new ServiceError('conflict', 'The proposal was rejected')
    }
    if (status === 'expired') {
      throw new ServiceError('conflict', 'The proposal has expired: no one edited it for 24 hours')
    }
    return projectIds
  }

  async #requireEditor(tx: Transaction, caller: Caller, projectIds: readonly string[]) {
    for (const projectId of projectIds) {
      const role = await this.#roles.roleOf(caller.accountId, projectId, tx)
      if (role === undefined) throw notVisible()
      if (!allows(role, 'edit-plan')) throw new ServiceError('forbidden', ROLE_REFUSAL)
    }
  }

  /**
   * Records the edit's time, from which the proposal's 24 hours start again (DD-024), and the
   * projects the proposal now changes (DD-025).
   */
  async #touch(tx: Transaction, proposalId: string) {
    await tx
      .update(proposals)
      .set({ lastEditedAt: this.#now() })
      .where(eq(proposals.id, proposalId))
    const changed = await tx
      .selectDistinct({ projectId: proposalChanges.projectId })
      .from(proposalChanges)
      .innerJoin(proposalGroups, eq(proposalGroups.id, proposalChanges.groupId))
      .where(eq(proposalGroups.proposalId, proposalId))
    await tx.delete(proposalProjects).where(eq(proposalProjects.proposalId, proposalId))
    await tx
      .insert(proposalProjects)
      .values(changed.map(({ projectId }) => ({ proposalId, projectId })))
  }
}

async function groupOf(tx: Transaction, proposalId: string, groupId: string) {
  if (!isUuid(groupId)) throw noGroup()
  const [group] = await tx
    .select({ id: proposalGroups.id })
    .from(proposalGroups)
    .where(and(eq(proposalGroups.id, groupId), eq(proposalGroups.proposalId, proposalId)))
  if (!group) throw noGroup()
  return group
}

/** The projects a group's changes change, in the order of their ids. */
async function projectsOfGroup(tx: Transaction, groupId: string): Promise<string[]> {
  const rows = await tx
    .selectDistinct({ projectId: proposalChanges.projectId })
    .from(proposalChanges)
    .where(eq(proposalChanges.groupId, groupId))
    .orderBy(asc(proposalChanges.projectId))
  return rows.map((row) => row.projectId)
}

/** The keys of the new tasks the proposal's groups other than `groupId` create. */
async function newTaskKeys(tx: Transaction, proposalId: string, groupId: string) {
  const rows = await tx
    .select({ groupId: proposalChanges.groupId, change: proposalChanges.change })
    .from(proposalChanges)
    .innerJoin(proposalGroups, eq(proposalGroups.id, proposalChanges.groupId))
    .where(and(eq(proposalGroups.proposalId, proposalId), eq(proposalChanges.kind, 'create-task')))
  const keys = new Set<string>()
  for (const row of rows) {
    if (row.groupId !== groupId && row.change.kind === 'create-task') keys.add(row.change.key)
  }
  return keys
}

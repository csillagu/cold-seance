/** A proposal as the REST API gives it (`GET /proposals/{id}`), the fields the screens read. */
export interface ApiProposal {
  id: string
  createdBy: string
  channel: 'ui' | 'rest-api' | 'mcp'
  createdAt: string
  lastEditedAt: string
  status: ProposalStatus
  /** The projects' parts approved since it was last edited (SC-048). */
  approvals: ApiPartApproval[]
  projectIds: string[]
  groups: ApiGroup[]
}

/** A project's part of a proposal approved, as the REST API gives it. */
export interface ApiPartApproval {
  projectId: string
  approvedBy: string
  channel: 'ui' | 'rest-api' | 'mcp'
  approvedAt: string
}

/** A task a change names: an existing one by its id, or one the proposal creates by its key. */
export interface ApiTaskRef {
  taskId?: string
  newTask?: string
}

/** A change of a proposal as the REST API gives it: the fields its kind has, and its id. */
export interface ApiChange {
  id: string
  kind: string
  projectId: string
  key?: string
  task?: ApiTaskRef
  fields?: Record<string, unknown>
  parent?: ApiTaskRef | null
  blocker?: ApiTaskRef
  status?: string
  repositoryId?: string
}

/** A group of changes, kept, edited or dropped as one (DD-023). */
export interface ApiGroup {
  id: string
  changes: ApiChange[]
}

/** A change that conflicts, as `GET /proposals/{id}/conflicts` gives it (SC-047). */
export interface ApiConflict {
  groupId: string
  changeId: string
  taskId: string
  reason: 'edited' | 'deleted'
  inputs: string[]
}

/** A proposal's conflicts, as the REST API gives them. */
export interface ApiConflicts {
  proposalId: string
  conflicts: ApiConflict[]
}

/** Where a proposal stands (SC-046). */
export type ProposalStatus = 'waiting' | 'approved' | 'rejected' | 'expired'

/** A proposal's status as the screens say it. */
export const PROPOSAL_STATUS_WORDS: Record<ProposalStatus, string> = {
  waiting: 'Waiting for review',
  approved: 'Approved',
  rejected: 'Rejected',
  expired: 'Expired',
}

/** A moment as the screens write it, in the browser's time zone: `12 Nov 2026, 14:05`. */
export function formatWhen(at: string): string {
  return new Date(at).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' })
}

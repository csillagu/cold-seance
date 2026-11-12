/** A proposal as the REST API gives it (`GET /proposals/{id}`), the fields the screens read. */
export interface ApiProposal {
  id: string
  createdBy: string
  channel: 'ui' | 'rest-api' | 'mcp'
  createdAt: string
  lastEditedAt: string
  status: ProposalStatus
  projectIds: string[]
  groups: { id: string; changes: { id: string; kind: string }[] }[]
}

/** Where a proposal stands (SC-046). */
export type ProposalStatus = 'waiting' | 'rejected' | 'expired'

/** A proposal's status as the screens say it. */
export const PROPOSAL_STATUS_WORDS: Record<ProposalStatus, string> = {
  waiting: 'Waiting for review',
  rejected: 'Rejected',
  expired: 'Expired',
}

/** A moment as the screens write it, in the browser's time zone: `12 Nov 2026, 14:05`. */
export function formatWhen(at: string): string {
  return new Date(at).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' })
}

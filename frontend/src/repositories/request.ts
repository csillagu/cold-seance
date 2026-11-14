import { fullName } from './repository.ts'

/** Where a project's request for a repository stands, as the REST API gives it (SC-110). */
export type RequestState = 'requested' | 'approved' | 'rejected' | 'withdrawn' | 'removed'

/** A person named on a request. */
export interface RequestPerson {
  accountId: string
  username: string
}

/**
 * A project's request to add a repository, as `GET /api/repository-requests` lists those for the
 * repositories the caller is an admin of, newest first.
 */
export interface RepositoryRequest {
  id: string
  project: { id: string; name: string }
  repository: { id: string; githubId: number; owner: string; name: string }
  state: RequestState
  requestedBy: RequestPerson
  requestedAt: string
  decidedBy: RequestPerson | null
  decidedAt: string | null
  withdrawnBy: RequestPerson | null
  withdrawnAt: string | null
  removedBy: RequestPerson | null
  removedAt: string | null
}

/** The requests sorted into what the repository request inbox (SC-087) shows in each table. */
export interface Inbox {
  /** Waiting for one of the repository's admins to approve or reject them (FR-168, FR-171). */
  waiting: RepositoryRequest[]
  /** Approved and in force, so that an admin may withdraw them (FR-172). */
  approved: RepositoryRequest[]
  /**
   * Rejected, or approved and withdrawn or removed from the project since: nothing more can be
   * done with them.
   */
  closed: RepositoryRequest[]
}

/** Sorts `requests` into the inbox's tables, keeping their order, newest first, in each. */
export function inboxOf(requests: readonly RepositoryRequest[]): Inbox {
  const inbox: Inbox = { waiting: [], approved: [], closed: [] }
  for (const request of requests) {
    if (request.state === 'requested') inbox.waiting.push(request)
    else if (request.state === 'approved') inbox.approved.push(request)
    else inbox.closed.push(request)
  }
  return inbox
}

/**
 * How a closed request is described, with who closed it: "Rejected by bob", "Withdrawn by bob"
 * for an approval taken back, or "Removed by alice" for a repository the project's admin removed
 * from the project.
 */
export function closedBy(request: RepositoryRequest): string {
  if (request.state === 'withdrawn') {
    return `Withdrawn by ${request.withdrawnBy?.username ?? 'an admin'}`
  }
  if (request.state === 'removed') {
    return `Removed by ${request.removedBy?.username ?? "the project's admin"}`
  }
  return `Rejected by ${request.decidedBy?.username ?? 'an admin'}`
}

/** A short name for the request, for the controls' labels: "Apollo's request for owner/name". */
export function requestName(request: RepositoryRequest): string {
  return `${request.project.name}'s request for ${fullName(request.repository)}`
}

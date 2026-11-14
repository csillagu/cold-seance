import type { RepositoryRequest } from './request.ts'
import { fullName } from './repository.ts'

/** A repository as the project's routes give it: `GET /api/projects/<id>/repositories`. */
export interface ProjectRepository {
  id: string
  githubId: number
  owner: string
  name: string
}

/**
 * A repository the project is the receiving project of, as
 * `GET /api/projects/<id>/receiving-repositories` lists it, with whether the project still pulls
 * issues from it.
 */
export interface ReceivingRepository {
  repository: ProjectRepository
  pulls: boolean
}

/** One row of the project's repository table (SC-081, SC-112). */
export interface RepositoryRow {
  repository: ProjectRepository
  /** Whether the project pulls issues from the repository (FR-142). */
  pulls: boolean
  /** Whether the project is the repository's receiving project (FR-143). */
  receiving: boolean
}

/**
 * The rows of the project's repository table: each repository it pulls issues from, marked as
 * receiving where the project is the receiving one; then each it is still the receiving project
 * of but no longer pulls from, so that its admin can give the role up (FR-180). By full name.
 */
export function repositoryRows(
  pulled: readonly ProjectRepository[],
  receiving: readonly ReceivingRepository[],
): RepositoryRow[] {
  const receives = new Set(receiving.map((r) => r.repository.id))
  const pulledIds = new Set(pulled.map((r) => r.id))
  const rows: RepositoryRow[] = [
    ...pulled.map((repository) => ({
      repository,
      pulls: true,
      receiving: receives.has(repository.id),
    })),
    ...receiving
      .filter((r) => !pulledIds.has(r.repository.id))
      .map((r) => ({ repository: r.repository, pulls: false, receiving: true })),
  ]
  return rows.toSorted((a, b) => fullName(a.repository).localeCompare(fullName(b.repository)))
}

/** The project's requests that wait for one of the repository's admins (FR-142). */
export function waitingRequests(requests: readonly RepositoryRequest[]): RepositoryRequest[] {
  return requests.filter((request) => request.state === 'requested')
}

/**
 * The registered repositories the project's admin may still ask to add: those the project neither
 * pulls issues from nor has a request waiting for, which the REST API would refuse.
 */
export function addableRepositories<R extends { id: string }>(
  registered: readonly R[],
  pulled: readonly ProjectRepository[],
  requests: readonly RepositoryRequest[],
): R[] {
  const taken = new Set([
    ...pulled.map((r) => r.id),
    ...waitingRequests(requests).map((r) => r.repository.id),
  ])
  return registered.filter((repository) => !taken.has(repository.id))
}

/**
 * What the screen says once the admin has asked to add `request`'s repository: added at once when
 * they are also its admin (FR-170), or else waiting for one of its admins' approval (FR-142).
 */
export function askedOutcome(request: RepositoryRequest): string {
  const repository = fullName(request.repository)
  return request.state === 'approved'
    ? `${repository} is added to ${request.project.name}.`
    : `${request.project.name}'s request for ${repository} waits for one of its admins to approve it.`
}

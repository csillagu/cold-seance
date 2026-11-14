import { describe, expect, it } from 'vitest'
import {
  addableRepositories,
  askedOutcome,
  repositoryRows,
  waitingRequests,
} from './project-settings.ts'
import type { RepositoryRequest } from './request.ts'

const repo = (id: string, name: string) => ({ id, githubId: 1, owner: 'csillagu', name })
const tcRepo = repo('r1', 'tc-repo')
const other = repo('r2', 'another')
const third = repo('r3', 'zeta')

function request(repository: typeof tcRepo, state: RepositoryRequest['state']): RepositoryRequest {
  return {
    id: `q-${repository.id}-${state}`,
    project: { id: 'p1', name: 'Apollo' },
    repository,
    state,
    requestedBy: { accountId: 'a1', username: 'alice' },
    requestedAt: '2026-11-14T10:00:00.000Z',
    decidedBy: null,
    decidedAt: null,
    withdrawnBy: null,
    withdrawnAt: null,
  }
}

describe('the project repository settings model (SC-081, SC-112)', () => {
  it('marks the pulled repositories the project receives, by full name', () => {
    expect(repositoryRows([tcRepo, other], [{ repository: tcRepo, pulls: true }])).toEqual([
      { repository: other, pulls: true, receiving: false },
      { repository: tcRepo, pulls: true, receiving: true },
    ])
  })

  it('keeps a repository the project still receives but no longer pulls, to give it up', () => {
    expect(repositoryRows([], [{ repository: tcRepo, pulls: false }])).toEqual([
      { repository: tcRepo, pulls: false, receiving: true },
    ])
  })

  it('keeps only the waiting requests', () => {
    const waiting = request(tcRepo, 'requested')
    expect(waitingRequests([waiting, request(other, 'rejected')])).toEqual([waiting])
  })

  it('offers the registered repositories neither pulled nor waiting', () => {
    expect(
      addableRepositories(
        [tcRepo, other, third],
        [other],
        [request(tcRepo, 'requested'), request(third, 'rejected')],
      ),
    ).toEqual([third])
  })

  it('says whether the repository was added at once or waits for approval (FR-142, FR-170)', () => {
    expect(askedOutcome(request(tcRepo, 'approved'))).toBe('csillagu/tc-repo is added to Apollo.')
    expect(askedOutcome(request(tcRepo, 'requested'))).toBe(
      "Apollo's request for csillagu/tc-repo waits for one of its admins to approve it.",
    )
  })
})

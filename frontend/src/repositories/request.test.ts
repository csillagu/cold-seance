import { describe, expect, it } from 'vitest'
import { closedBy, inboxOf, type RepositoryRequest, requestName } from './request.ts'

const bob = { accountId: '00000000-0000-4000-8000-0000000000b1', username: 'bob' }
const alice = { accountId: '00000000-0000-4000-8000-0000000000a1', username: 'alice' }

function request(id: string, state: RepositoryRequest['state']): RepositoryRequest {
  return {
    id,
    project: { id: '00000000-0000-4000-8000-000000000001', name: 'Apollo' },
    repository: {
      id: '00000000-0000-4000-8000-000000000002',
      githubId: 2,
      owner: 'csillagu',
      name: 'tc-repo',
    },
    state,
    requestedBy: { accountId: '00000000-0000-4000-8000-0000000000a1', username: 'alice' },
    requestedAt: '2026-11-14T10:00:00.000Z',
    decidedBy: state === 'requested' ? null : bob,
    decidedAt: state === 'requested' ? null : '2026-11-14T11:00:00.000Z',
    withdrawnBy: state === 'withdrawn' ? bob : null,
    withdrawnAt: state === 'withdrawn' ? '2026-11-14T12:00:00.000Z' : null,
    removedBy: state === 'removed' ? alice : null,
    removedAt: state === 'removed' ? '2026-11-14T13:00:00.000Z' : null,
  }
}

describe('the repository request inbox model (SC-087)', () => {
  it('sorts the requests into waiting, approved and closed, keeping their order', () => {
    const listed = [
      request('1', 'withdrawn'),
      request('2', 'requested'),
      request('3', 'approved'),
      request('4', 'rejected'),
      request('5', 'requested'),
      request('6', 'removed'),
    ]
    const inbox = inboxOf(listed)
    expect(inbox.waiting.map((r) => r.id)).toEqual(['2', '5'])
    expect(inbox.approved.map((r) => r.id)).toEqual(['3'])
    expect(inbox.closed.map((r) => r.id)).toEqual(['1', '4', '6'])
  })

  it('says who closed a request: the rejecter, who withdrew the approval, or who removed it', () => {
    expect(closedBy(request('1', 'rejected'))).toBe('Rejected by bob')
    expect(closedBy(request('1', 'withdrawn'))).toBe('Withdrawn by bob')
    expect(closedBy(request('1', 'removed'))).toBe('Removed by alice')
  })

  it('names a request by its project and repository', () => {
    expect(requestName(request('1', 'requested'))).toBe("Apollo's request for csillagu/tc-repo")
  })
})

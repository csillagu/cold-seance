import { afterEach, describe, expect, it, vi } from 'vitest'
import { fakeApi, UNAUTHENTICATED } from '../test/fetch.ts'
import {
  loadOverlay,
  loadPendingProposals,
  pendingChanges,
  pendingSummaries,
  type PendingProposal,
} from './overlay.ts'
import type { ApiDifference, Names, PreviewTask } from './preview-model.ts'

const APOLLO = 'p-apollo'
const ZEUS = 'p-zeus'
const ALICE = 'u-alice'
const BOB = 'u-bob'

const names: Names = {
  people: new Map([
    [ALICE, 'alice'],
    [BOB, 'bob'],
  ]),
  projects: new Map([[APOLLO, 'Apollo']]),
  tasks: new Map([['A', 'A']]),
}

function task(id: string, fields: Partial<PreviewTask> = {}): PreviewTask {
  return {
    id,
    projectId: APOLLO,
    title: id,
    status: 'not-started',
    plannedStart: '2027-03-01',
    plannedFinish: '2027-03-01',
    durationWorkingDays: 1,
    effort: null,
    aiShare: 0,
    personLoad: 100,
    milestone: null,
    assignees: [ALICE],
    parentId: null,
    blockedBy: [],
    ...fields,
  }
}

const moved: ApiDifference = {
  taskId: 'A',
  projectId: APOLLO,
  newTask: null,
  before: task('A'),
  after: task('A', { plannedStart: '2027-03-08', plannedFinish: '2027-03-08', assignees: [BOB] }),
}
const created: ApiDifference = {
  taskId: 'new-1',
  projectId: APOLLO,
  newTask: 'n1',
  before: null,
  after: task('new-1', { title: 'Proposed task', plannedStart: null, plannedFinish: null }),
}
const elsewhere: ApiDifference = {
  taskId: 'Z',
  projectId: ZEUS,
  newTask: null,
  before: task('Z', { projectId: ZEUS }),
  after: task('Z', { projectId: ZEUS, plannedStart: '2027-03-02', plannedFinish: '2027-03-02' }),
}

const pending = (proposalId: string, differences: ApiDifference[]): PendingProposal => ({
  proposalId,
  preview: { proposalId, planVersion: 'v1', differences, newRedFlags: [] },
  refused: null,
})

describe('the pending overlay (SC-068, FR-073)', () => {
  it("gives each of the project's tasks a proposal would change or create, in words", () => {
    const changes = pendingChanges([pending('x', [moved, elsewhere, created])], APOLLO, names)
    expect(changes).toEqual([
      {
        proposalId: 'x',
        taskId: 'A',
        created: false,
        after: moved.after,
        assigneesChanged: true,
        lines: [
          'Start: 1 Mar 2027 → 8 Mar 2027',
          'Finish: 1 Mar 2027 → 8 Mar 2027',
          'Assigned: alice → bob',
        ],
      },
      {
        proposalId: 'x',
        taskId: 'new-1',
        created: true,
        after: created.after,
        assigneesChanged: true,
        lines: ['AI share: 0%'],
      },
    ])
  })

  it('gives none for a proposal that cannot be previewed, and counts each one', () => {
    const proposals: PendingProposal[] = [
      pending('x', [moved, elsewhere]),
      { proposalId: 'y', preview: null, refused: 'A is deleted' },
    ]
    const changes = pendingChanges(proposals, APOLLO, names)
    expect(changes.map((change) => change.proposalId)).toEqual(['x'])
    expect(pendingSummaries(proposals, changes)).toEqual([
      { proposalId: 'x', changes: 1, refused: null },
      { proposalId: 'y', changes: 0, refused: 'A is deleted' },
    ])
  })
})

describe('loading the pending overlay', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  const proposal = (id: string, status: string) => ({ id, status, projectIds: [APOLLO] })

  it('reads the preview of each proposal waiting for review only, and only reads', async () => {
    const requests = fakeApi((_method, path) => {
      switch (path) {
        case `/api/projects/${APOLLO}/proposals`:
          return {
            status: 200,
            body: [proposal('x', 'waiting'), proposal('r', 'rejected'), proposal('e', 'expired')],
          }
        case '/api/proposals/x/preview':
          return { status: 200, body: { proposalId: 'x', differences: [moved], newRedFlags: [] } }
        default:
          return { status: 404, body: { message: 'Not found' } }
      }
    })
    expect(await loadPendingProposals(APOLLO)).toEqual([
      {
        proposalId: 'x',
        preview: { proposalId: 'x', differences: [moved], newRedFlags: [] },
        refused: null,
      },
    ])
    expect(requests.map(({ method, path }) => `${method} ${path}`)).toEqual([
      `GET /api/projects/${APOLLO}/proposals`,
      'GET /api/proposals/x/preview',
    ])
  })

  it('gives the refusal of a proposal that cannot be previewed on the plan as it is now', async () => {
    fakeApi((_method, path) =>
      path === '/api/proposals/x/preview'
        ? { status: 409, body: { statusCode: 409, error: 'Conflict', message: 'A is deleted' } }
        : { status: 200, body: [proposal('x', 'waiting')] },
    )
    expect(await loadPendingProposals(APOLLO)).toEqual([
      { proposalId: 'x', preview: null, refused: 'A is deleted' },
    ])
  })

  it('gives null when the proposals cannot be read, but passes on a sign-in refusal', async () => {
    fakeApi(() => ({ status: 500, body: { message: 'Failed' } }))
    expect(await loadOverlay(APOLLO)).toBeNull()
    fakeApi(() => UNAUTHENTICATED)
    await expect(loadOverlay(APOLLO)).rejects.toThrow('Not signed in')
  })
})

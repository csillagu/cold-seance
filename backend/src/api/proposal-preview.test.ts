import { afterEach, describe, expect, it, vi } from 'vitest'
import { buildApp } from '../app.ts'
import { createDatabase } from '../db/client.ts'
import { ServiceError } from '../service/errors.ts'
import type { PreviewedTask, ProposalPreview } from '../service/proposal-preview.ts'
import { createServices } from '../service/services.ts'
import type { Authenticator } from './caller.ts'

// The proposal preview route translates requests for the proposal preview and nothing more
// (DD-039); the rules are tested against the database in
// test/integration/proposal-preview.test.ts. Here the service is a stub, so these tests show what
// the route hands it and what it sends back.

const ERIN = '6f1c2a5e-0000-4000-8000-000000000005'
const APOLLO = '6f1c2a5e-0000-4000-8000-0000000000c1'
const A = '6f1c2a5e-0000-4000-8000-0000000000b1'
const N = '6f1c2a5e-0000-4000-8000-0000000000b2'
const P1 = '6f1c2a5e-0000-4000-8000-0000000000e1'

const TASK: PreviewedTask = {
  id: A,
  projectId: APOLLO,
  title: 'A',
  description: '',
  status: 'not-started',
  plannedStart: '2027-03-01',
  plannedFinish: '2027-03-03',
  durationWorkingDays: 3,
  effort: null,
  aiShare: 0,
  personLoad: 100,
  milestone: null,
  eligibility: null,
  assignees: [ERIN],
  loadOverrides: {},
  withoutReadAccess: [],
  actualStart: null,
  actualFinish: null,
  repositoryId: null,
  githubIssue: null,
  parentId: null,
  blockedBy: [],
}

const PREVIEW: ProposalPreview = {
  proposalId: P1,
  differences: [
    {
      taskId: A,
      projectId: APOLLO,
      newTask: null,
      before: TASK,
      after: { ...TASK, plannedFinish: '2027-03-05', durationWorkingDays: 5 },
    },
    {
      taskId: N,
      projectId: APOLLO,
      newTask: 'new',
      before: null,
      after: { ...TASK, id: N, title: 'New', blockedBy: [A] },
    },
  ],
  newRedFlags: [
    {
      projectId: APOLLO,
      kind: 'overload',
      key: `overload:${ERIN}:2027-03-05`,
      detail: { accountId: ERIN, date: '2027-03-05' },
    },
  ],
}

const asErin: Authenticator = async (request) =>
  request.headers.authorization === 'Bearer erin'
    ? { accountId: ERIN, channel: 'rest-api' }
    : undefined
const erin = { authorization: 'Bearer erin' }

let closers: (() => Promise<unknown>)[] = []
afterEach(async () => {
  await Promise.all(closers.map((close) => close()))
  closers = []
})

function stubbed() {
  const { db, close } = createDatabase('postgres://nobody@unused.invalid/none')
  const services = createServices(db)
  const previewProposal = vi.spyOn(services.proposalPreview, 'previewProposal')
  const app = buildApp({}, { authenticators: [asErin], services })
  closers.push(async () => {
    await app.close()
    await close()
  })
  return { app, previewProposal }
}

describe('GET /api/proposals/:proposalId/preview', () => {
  it('sends the differences and the new red flags, each flag with its detail', async () => {
    const { app, previewProposal } = stubbed()
    previewProposal.mockResolvedValue(PREVIEW)
    const response = await app.inject({
      method: 'GET',
      url: `/api/proposals/${P1}/preview`,
      headers: erin,
    })
    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual({
      proposalId: P1,
      differences: PREVIEW.differences,
      newRedFlags: [{ kind: 'overload', projectId: APOLLO, accountId: ERIN, date: '2027-03-05' }],
    })
    expect(previewProposal).toHaveBeenCalledWith({ accountId: ERIN, channel: 'rest-api' }, P1)
  })

  it("answers the preview's refusal", async () => {
    const { app, previewProposal } = stubbed()
    previewProposal.mockRejectedValue(new ServiceError('conflict', 'Change 1 cannot be made'))
    const response = await app.inject({
      method: 'GET',
      url: `/api/proposals/${P1}/preview`,
      headers: erin,
    })
    expect(response.statusCode).toBe(409)
    expect(response.json<{ message: string }>().message).toBe('Change 1 cannot be made')
  })

  it('refuses an id that is not a uuid before the preview is reached', async () => {
    const { app, previewProposal } = stubbed()
    const response = await app.inject({
      method: 'GET',
      url: '/api/proposals/nope/preview',
      headers: erin,
    })
    expect(response.statusCode).toBe(400)
    expect(previewProposal).not.toHaveBeenCalled()
  })
})

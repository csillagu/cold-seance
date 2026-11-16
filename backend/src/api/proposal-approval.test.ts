import { afterEach, describe, expect, it, vi } from 'vitest'
import { buildApp } from '../app.ts'
import { createDatabase } from '../db/client.ts'
import { ServiceError } from '../service/errors.ts'
import type { ProposalPreview } from '../service/proposal-preview.ts'
import type { Proposal } from '../service/proposals.ts'
import { createServices } from '../service/services.ts'
import type { Authenticator } from './caller.ts'

// The route that approves a proposal's part translates requests for the service layer and nothing
// more (DD-039); the rules are tested against the database in
// test/integration/proposal-approval.test.ts. Here the service is a stub.

const ERIN = '6f1c2a5e-0000-4000-8000-000000000005'
const APOLLO = '6f1c2a5e-0000-4000-8000-0000000000c1'
const A = '6f1c2a5e-0000-4000-8000-0000000000b1'
const P1 = '6f1c2a5e-0000-4000-8000-0000000000e1'
const G1 = '6f1c2a5e-0000-4000-8000-0000000000f1'
const C1 = '6f1c2a5e-0000-4000-8000-0000000000f2'
const AT = new Date('2027-02-26T10:00:00.000Z')
const PROPOSAL: Proposal = {
  id: P1,
  createdBy: ERIN,
  channel: 'mcp',
  createdAt: AT,
  lastEditedAt: AT,
  status: 'approved',
  rejectedAt: null,
  rejectedBy: null,
  appliedAt: AT,
  approvals: [{ projectId: APOLLO, approvedBy: ERIN, channel: 'ui', approvedAt: AT }],
  projectIds: [APOLLO],
  groups: [
    { id: G1, changes: [{ id: C1, kind: 'cancel-task', projectId: APOLLO, task: { taskId: A } }] },
  ],
}
const SENT = {
  ...PROPOSAL,
  createdAt: AT.toISOString(),
  lastEditedAt: AT.toISOString(),
  appliedAt: AT.toISOString(),
  approvals: [{ projectId: APOLLO, approvedBy: ERIN, channel: 'ui', approvedAt: AT.toISOString() }],
}
const PREVIEW: ProposalPreview = {
  proposalId: P1,
  planVersion: 'c0ffee',
  differences: [],
  newRedFlags: [
    {
      kind: 'overload',
      projectId: APOLLO,
      key: 'k',
      detail: { accountId: ERIN, date: '2027-03-05' },
    },
  ],
}

const asErin: Authenticator = async (request) =>
  request.headers.authorization === 'Bearer erin' ? { accountId: ERIN, channel: 'ui' } : undefined
const erin = { authorization: 'Bearer erin' }
const caller = { accountId: ERIN, channel: 'ui' }

let closers: (() => Promise<unknown>)[] = []
afterEach(async () => {
  await Promise.all(closers.map((close) => close()))
  closers = []
})

function stubbed() {
  const { db, close } = createDatabase('postgres://nobody@unused.invalid/none')
  const services = createServices(db)
  const approve = vi.spyOn(services.proposalApproval, 'approve')
  const app = buildApp({}, { authenticators: [asErin], services })
  closers.push(async () => {
    await app.close()
    await close()
  })
  return { app, approve }
}

const post = (app: ReturnType<typeof buildApp>, payload: object) =>
  app.inject({ method: 'POST', url: `/api/proposals/${P1}/approval`, headers: erin, payload })

describe('POST /api/proposals/:proposalId/approval', () => {
  it('hands the approval to the service as it was sent, and sends what it did', async () => {
    const { app, approve } = stubbed()
    approve.mockResolvedValue({ outcome: 'applied', proposal: PROPOSAL })
    const response = await post(app, { projectId: APOLLO, planVersion: 'c0ffee' })
    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual({ outcome: 'applied', proposal: SENT, preview: null })
    expect(approve).toHaveBeenCalledWith(caller, P1, { projectId: APOLLO, planVersion: 'c0ffee' })
  })

  it('sends the new preview to confirm again', async () => {
    const { app, approve } = stubbed()
    approve.mockResolvedValue({ outcome: 'confirm-again', proposal: PROPOSAL, preview: PREVIEW })
    const response = await post(app, { projectId: APOLLO })
    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual({
      outcome: 'confirm-again',
      proposal: SENT,
      preview: {
        proposalId: P1,
        planVersion: 'c0ffee',
        differences: [],
        newRedFlags: [{ kind: 'overload', projectId: APOLLO, accountId: ERIN, date: '2027-03-05' }],
      },
    })
  })

  it('refuses a body without the project before the service is reached', async () => {
    const { app, approve } = stubbed()
    const response = await post(app, { planVersion: 'c0ffee' })
    expect(response.statusCode).toBe(400)
    expect(approve).not.toHaveBeenCalled()
  })

  it("answers the service's refusal", async () => {
    const { app, approve } = stubbed()
    approve.mockRejectedValue(new ServiceError('conflict', 'The proposal has expired'))
    const response = await post(app, { projectId: APOLLO })
    expect(response.statusCode).toBe(409)
    expect(response.json<{ message: string }>().message).toBe('The proposal has expired')
  })
})

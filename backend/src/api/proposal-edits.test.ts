import { afterEach, describe, expect, it, vi } from 'vitest'
import { buildApp } from '../app.ts'
import { createDatabase } from '../db/client.ts'
import { ServiceError } from '../service/errors.ts'
import type { Proposal } from '../service/proposals.ts'
import { createServices } from '../service/services.ts'
import type { Authenticator } from './caller.ts'

// The routes that edit and reject a proposal translate requests for the service layer and nothing
// more (DD-039); the rules are tested against the database in
// test/integration/proposal-edits.test.ts. Here the service is a stub.

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
  status: 'rejected',
  rejectedAt: AT,
  rejectedBy: ERIN,
  appliedAt: null,
  approvals: [],
  projectIds: [APOLLO],
  groups: [
    { id: G1, changes: [{ id: C1, kind: 'cancel-task', projectId: APOLLO, task: { taskId: A } }] },
  ],
}
const SENT = {
  ...PROPOSAL,
  createdAt: AT.toISOString(),
  lastEditedAt: AT.toISOString(),
  rejectedAt: AT.toISOString(),
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
  const editGroup = vi.spyOn(services.proposalEdits, 'editGroup')
  const dropGroup = vi.spyOn(services.proposalEdits, 'dropGroup')
  const rejectProposal = vi.spyOn(services.proposalEdits, 'rejectProposal')
  const app = buildApp({}, { authenticators: [asErin], services })
  closers.push(async () => {
    await app.close()
    await close()
  })
  return { app, editGroup, dropGroup, rejectProposal }
}

describe('PUT /api/proposals/:proposalId/groups/:groupId', () => {
  it("hands the group's changes to the service as they were sent", async () => {
    const { app, editGroup } = stubbed()
    editGroup.mockResolvedValue(PROPOSAL)
    const changes = [{ kind: 'update-task', task: { taskId: A }, fields: { plannedStart: 1 } }]
    const response = await app.inject({
      method: 'PUT',
      url: `/api/proposals/${P1}/groups/${G1}`,
      headers: erin,
      payload: { changes },
    })
    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual(SENT)
    expect(editGroup).toHaveBeenCalledWith(caller, P1, G1, { changes })
  })

  it('refuses a body without the changes before the service is reached', async () => {
    const { app, editGroup } = stubbed()
    const response = await app.inject({
      method: 'PUT',
      url: `/api/proposals/${P1}/groups/${G1}`,
      headers: erin,
      payload: { groups: [] },
    })
    expect(response.statusCode).toBe(400)
    expect(editGroup).not.toHaveBeenCalled()
  })

  it("answers the service's refusal", async () => {
    const { app, editGroup } = stubbed()
    editGroup.mockRejectedValue(new ServiceError('conflict', 'The proposal has expired'))
    const response = await app.inject({
      method: 'PUT',
      url: `/api/proposals/${P1}/groups/${G1}`,
      headers: erin,
      payload: { changes: [] },
    })
    expect(response.statusCode).toBe(409)
    expect(response.json<{ message: string }>().message).toBe('The proposal has expired')
  })
})

describe('DELETE /api/proposals/:proposalId/groups/:groupId', () => {
  it('drops the group', async () => {
    const { app, dropGroup } = stubbed()
    dropGroup.mockResolvedValue(PROPOSAL)
    const response = await app.inject({
      method: 'DELETE',
      url: `/api/proposals/${P1}/groups/${G1}`,
      headers: erin,
    })
    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual(SENT)
    expect(dropGroup).toHaveBeenCalledWith(caller, P1, G1)
  })
})

describe('POST /api/proposals/:proposalId/rejection', () => {
  it('rejects the proposal, with or without an empty body', async () => {
    const { app, rejectProposal } = stubbed()
    rejectProposal.mockResolvedValue(PROPOSAL)
    for (const payload of [undefined, {}]) {
      const response = await app.inject({
        method: 'POST',
        url: `/api/proposals/${P1}/rejection`,
        headers: erin,
        ...(payload === undefined ? {} : { payload }),
      })
      expect(response.statusCode).toBe(200)
      expect(response.json()).toEqual(SENT)
    }
    expect(rejectProposal).toHaveBeenCalledWith(caller, P1)
  })
})

import { render, screen, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { fakeApi, type FakeAnswer, UNAUTHENTICATED } from '../test/fetch.ts'
import { ProjectPage } from './ProjectPage.tsx'
import { NO_SUCH_PROPOSAL, ProposalPage } from './ProposalPage.tsx'
import { ProposalsPage } from './ProposalsPage.tsx'

const APOLLO = '00000000-0000-4000-8000-000000000001'
const ALICE = '00000000-0000-4000-8000-0000000000a1'
const BOB = '00000000-0000-4000-8000-0000000000b1'
const P1 = '00000000-0000-4000-8000-0000000000f1'
const A = '00000000-0000-4000-8000-00000000000a'
const B = '00000000-0000-4000-8000-00000000000b'

const proposal = {
  id: P1,
  createdBy: ALICE,
  channel: 'mcp',
  createdAt: '2026-11-12T10:00:00.000Z',
  lastEditedAt: '2026-11-12T10:00:00.000Z',
  status: 'waiting',
  rejectedAt: null,
  rejectedBy: null,
  projectIds: [APOLLO],
  groups: [{ id: 'g1', changes: [{ id: 'c1', kind: 'update-task', projectId: APOLLO }] }],
}

const task = (id: string, title: string, fields: Record<string, unknown> = {}) => ({
  id,
  projectId: APOLLO,
  title,
  status: 'not-started',
  plannedStart: '2027-03-01',
  plannedFinish: '2027-03-03',
  durationWorkingDays: 3,
  aiShare: 0,
  milestone: null,
  assignees: [],
  parentId: null,
  blockedBy: [],
  ...fields,
})

const preview = {
  proposalId: P1,
  differences: [
    {
      taskId: A,
      projectId: APOLLO,
      newTask: null,
      before: task(A, 'A'),
      after: task(A, 'A', { plannedFinish: '2027-03-05', durationWorkingDays: 5 }),
    },
    {
      taskId: B,
      projectId: APOLLO,
      newTask: null,
      before: task(B, 'B', { plannedStart: '2027-03-04', plannedFinish: '2027-03-05' }),
      after: task(B, 'B', {
        plannedStart: '2027-03-08',
        plannedFinish: '2027-03-09',
        assignees: [BOB],
      }),
    },
  ],
  newRedFlags: [{ kind: 'overload', projectId: APOLLO, accountId: ALICE, date: '2027-03-09' }],
}

function answers(overrides: Record<string, FakeAnswer> = {}) {
  return (_method: string, path: string): FakeAnswer => {
    if (overrides[path]) return overrides[path]
    switch (path) {
      case `/api/proposals/${P1}`:
        return { status: 200, body: proposal }
      case `/api/proposals/${P1}/preview`:
        return { status: 200, body: preview }
      case `/api/projects/${APOLLO}`:
        return { status: 200, body: { id: APOLLO, name: 'Apollo' } }
      case `/api/projects/${APOLLO}/members`:
        return {
          status: 200,
          body: [
            { accountId: ALICE, username: 'alice', role: 'admin' },
            { accountId: BOB, username: 'bob', role: 'read-write' },
          ],
        }
      case `/api/projects/${APOLLO}/tasks`:
        return { status: 200, body: [task(A, 'A'), task(B, 'B')] }
      case `/api/projects/${APOLLO}/proposals`:
        return { status: 200, body: [proposal] }
      default:
        return { status: 404, body: { statusCode: 404, error: 'Not Found', message: 'Not found' } }
    }
  }
}

function renderAt(path: string) {
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/sign-in" element={<h1>Sign in</h1>} />
        <Route path="/projects/:projectId" element={<ProjectPage />}>
          <Route path="proposals" element={<ProposalsPage />} />
        </Route>
        <Route path="/proposals/:proposalId" element={<ProposalPage />} />
      </Routes>
    </MemoryRouter>,
  )
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('the proposal preview page (SC-034)', () => {
  it('shows each task the proposal would change, before and after, and the new red flags', async () => {
    const requests = fakeApi(answers())
    renderAt(`/proposals/${P1}`)

    const table = await screen.findByRole('table', { name: 'What would change' })
    const a = within(table).getByRole('row', { name: 'A' })
    const cells = within(a).getAllByRole('cell')
    expect(cells.map((cell) => cell.textContent)).toEqual([
      '1 Mar 2027',
      '3 Mar 2027 → 5 Mar 2027',
      '3 → 5',
      '—',
      '—',
    ])
    const b = within(table).getByRole('row', { name: 'B' })
    expect(within(b).getAllByRole('cell')[0]).toHaveTextContent('4 Mar 2027 → 8 Mar 2027')
    expect(within(b).getAllByRole('cell')[3]).toHaveTextContent('— → bob')

    const flags = screen.getByRole('list', { name: 'New red flags' })
    expect(within(flags).getByRole('listitem')).toHaveTextContent(
      'alice overloaded on 9 Mar 2027in Apollo',
    )
    expect(screen.getByText('By alice')).toBeInTheDocument()
    expect(screen.getByText('Waiting for review')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Apollo' })).toHaveAttribute(
      'href',
      `/projects/${APOLLO}/gantt`,
    )
    // Opening the page only reads.
    expect(requests.every((request) => request.method === 'GET')).toBe(true)
  })

  it('says so when the proposal would change nothing and raise no red flag', async () => {
    fakeApi(
      answers({
        [`/api/proposals/${P1}/preview`]: {
          status: 200,
          body: { proposalId: P1, differences: [], newRedFlags: [] },
        },
      }),
    )
    renderAt(`/proposals/${P1}`)
    expect(await screen.findByText('The proposal would change no task.')).toBeInTheDocument()
    expect(screen.getByText('None: the proposal would raise no new red flag.')).toBeInTheDocument()
  })

  it('shows why a proposal cannot be previewed on the plan as it is now', async () => {
    const message =
      'Change 1 of group 1 of the proposal cannot be made on the plan as it is now: no such task'
    fakeApi(
      answers({
        [`/api/proposals/${P1}/preview`]: {
          status: 409,
          body: { statusCode: 409, error: 'Conflict', message },
        },
      }),
    )
    renderAt(`/proposals/${P1}`)
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('The proposal cannot be previewed')
    expect(alert).toHaveTextContent(message)
  })

  it('says so to someone who may not read the proposal', async () => {
    const message = 'This proposal is not visible to you'
    fakeApi(
      answers({
        [`/api/proposals/${P1}`]: {
          status: 403,
          body: { statusCode: 403, error: 'Not Visible', message },
        },
      }),
    )
    renderAt(`/proposals/${P1}`)
    expect(await screen.findByRole('heading', { name: message })).toBeInTheDocument()
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
  })

  it('says there is no such proposal for a malformed address', async () => {
    fakeApi(
      answers({
        '/api/proposals/nope': {
          status: 400,
          body: { statusCode: 400, error: 'Bad Request', message: 'params/proposalId' },
        },
      }),
    )
    renderAt('/proposals/nope')
    expect(await screen.findByRole('heading', { name: NO_SUCH_PROPOSAL })).toBeInTheDocument()
  })

  it('sends someone who is not signed in to the sign-in page', async () => {
    fakeApi(answers({ [`/api/proposals/${P1}`]: UNAUTHENTICATED }))
    renderAt(`/proposals/${P1}`)
    expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeInTheDocument()
  })
})

describe("the project's proposals (SC-034)", () => {
  it('lists the proposals that change the project, each leading to its preview', async () => {
    fakeApi(answers())
    renderAt(`/projects/${APOLLO}/proposals`)

    const table = await screen.findByRole('table', { name: 'Proposals of Apollo' })
    expect(screen.getByRole('link', { name: 'Proposals' })).toHaveAttribute('aria-current', 'page')
    const link = within(table).getByRole('link', { name: /^Proposal of / })
    expect(link).toHaveAttribute('href', `/proposals/${P1}`)
    const row = link.closest('tr')
    if (!row) throw new Error('The proposal has no row')
    expect(
      within(row)
        .getAllByRole('cell')
        .map((cell) => cell.textContent),
    ).toEqual(['alice', 'Waiting for review', '1'])
  })

  it('says so when no proposal changes the project', async () => {
    fakeApi(answers({ [`/api/projects/${APOLLO}/proposals`]: { status: 200, body: [] } }))
    renderAt(`/projects/${APOLLO}/proposals`)
    expect(await screen.findByText('No proposal changes this project.')).toBeInTheDocument()
  })
})

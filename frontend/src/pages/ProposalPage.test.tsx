import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
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
  appliedAt: null,
  approvals: [],
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
  planVersion: 'v1',
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
      case `/api/proposals/${P1}/conflicts`:
        return { status: 200, body: { proposalId: P1, conflicts: [] } }
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

describe('the proposal conflict panel (SC-070) and editor (SC-071)', () => {
  const G1 = '00000000-0000-4000-8000-0000000000c1'
  const G2 = '00000000-0000-4000-8000-0000000000c2'
  const move = {
    id: 'c1',
    kind: 'update-task',
    projectId: APOLLO,
    task: { taskId: A },
    fields: { plannedStart: '2027-03-08', assignees: [BOB] },
  }
  const status = {
    id: 'c2',
    kind: 'set-status',
    projectId: APOLLO,
    task: { taskId: B },
    status: 'in-progress',
  }
  const editable = {
    ...proposal,
    groups: [
      { id: G1, changes: [move] },
      { id: G2, changes: [status] },
    ],
  }
  const conflict = {
    groupId: G1,
    changeId: 'c1',
    taskId: A,
    reason: 'edited',
    inputs: ['plannedStart'],
  }

  /** The fake API with the editable proposal, `conflicts`, and the answer to each write. */
  function editableAnswers(conflicts: unknown[] = [], write: FakeAnswer = { status: 200 }) {
    const read = answers({
      [`/api/proposals/${P1}`]: { status: 200, body: editable },
      [`/api/proposals/${P1}/conflicts`]: { status: 200, body: { proposalId: P1, conflicts } },
    })
    return (method: string, path: string): FakeAnswer =>
      method === 'GET' ? read(method, path) : { body: editable, ...write }
  }

  it('shows no conflict when no one else changed what the proposal changes', async () => {
    fakeApi(editableAnswers())
    renderAt(`/proposals/${P1}`)
    expect(
      await screen.findByText(
        'None: no one else has changed what the proposal changes since it was proposed.',
      ),
    ).toBeInTheDocument()
    expect(screen.queryByRole('list', { name: 'Conflicts' })).not.toBeInTheDocument()
  })

  it('shows each conflict, with the choice to resolve it or drop it', async () => {
    fakeApi(editableAnswers([conflict]))
    renderAt(`/proposals/${P1}`)
    const list = await screen.findByRole('list', { name: 'Conflicts' })
    const item = within(list).getByRole('listitem')
    expect(item).toHaveAccessibleName(
      'Change A: planned start 8 Mar 2027, assigned people as proposed',
    )
    expect(item).toHaveTextContent(
      'Someone else changed the planned start of A after the change was proposed.',
    )
    expect(item).toHaveTextContent('In group 1')
    expect(within(item).getByRole('button', { name: 'Resolve' })).toBeEnabled()
    expect(within(item).getByRole('button', { name: 'Drop' })).toBeEnabled()
  })

  it('says a change to a deleted task conflicts', async () => {
    const gone = '00000000-0000-4000-8000-0000000000dd'
    fakeApi(
      answers({
        [`/api/proposals/${P1}`]: {
          status: 200,
          body: {
            ...proposal,
            groups: [{ id: G1, changes: [{ ...move, task: { taskId: gone } }] }],
          },
        },
        [`/api/proposals/${P1}/conflicts`]: {
          status: 200,
          body: {
            proposalId: P1,
            conflicts: [{ ...conflict, taskId: gone, reason: 'deleted', inputs: [] }],
          },
        },
      }),
    )
    renderAt(`/proposals/${P1}`)
    const item = within(await screen.findByRole('list', { name: 'Conflicts' })).getByRole(
      'listitem',
    )
    expect(item).toHaveTextContent('Change a deleted task: planned start 8 Mar 2027')
    expect(item).toHaveTextContent('Its task was deleted after the change was proposed.')
  })

  it("resolves a conflict by editing its group, saving the group's whole new list", async () => {
    const requests = fakeApi(editableAnswers([conflict]))
    renderAt(`/proposals/${P1}`)
    const list = await screen.findByRole('list', { name: 'Conflicts' })
    fireEvent.click(within(list).getByRole('button', { name: 'Resolve' }))

    const form = screen.getByRole('form', { name: 'Edit group 1' })
    const start = within(form).getByLabelText('Planned start')
    expect(start).toHaveValue('2027-03-08')
    expect(form).toHaveTextContent('Kept as proposed: Assigned people.')
    fireEvent.change(start, { target: { value: '2027-03-10' } })
    fireEvent.click(within(form).getByRole('button', { name: 'Save group' }))

    await waitFor(() =>
      expect(screen.queryByRole('form', { name: 'Edit group 1' })).not.toBeInTheDocument(),
    )
    const writes = requests.filter((request) => request.method !== 'GET')
    expect(writes).toEqual([
      {
        method: 'PUT',
        path: `/api/proposals/${P1}/groups/${G1}`,
        body: {
          changes: [
            {
              kind: 'update-task',
              task: { taskId: A },
              fields: { plannedStart: '2027-03-10', assignees: [BOB] },
            },
          ],
        },
      },
    ])
    // The proposal, its conflicts and its preview are read again.
    await waitFor(() =>
      expect(requests.filter((r) => r.path === `/api/proposals/${P1}/conflicts`)).toHaveLength(2),
    )
  })

  it('edits a status, and drops a group as a whole', async () => {
    const requests = fakeApi(editableAnswers())
    renderAt(`/proposals/${P1}`)
    const group2 = await screen.findByRole('listitem', { name: 'Group 2' })
    expect(group2).toHaveTextContent('Set B to in progress')
    fireEvent.click(within(group2).getByRole('button', { name: 'Edit group' }))
    const form = screen.getByRole('form', { name: 'Edit group 2' })
    fireEvent.change(within(form).getByLabelText('Status'), { target: { value: 'on-hold' } })
    // A group's only change cannot be left out on its own.
    expect(within(form).getByRole('button', { name: 'Leave this change out' })).toBeDisabled()
    fireEvent.click(within(form).getByRole('button', { name: 'Save group' }))
    await waitFor(() => expect(screen.queryByRole('form')).not.toBeInTheDocument())

    fireEvent.click(
      within(screen.getByRole('listitem', { name: 'Group 1' })).getByRole('button', {
        name: 'Drop group',
      }),
    )
    await waitFor(() =>
      expect(requests.filter((request) => request.method === 'DELETE')).toHaveLength(1),
    )
    expect(requests.filter((request) => request.method !== 'GET')).toEqual([
      {
        method: 'PUT',
        path: `/api/proposals/${P1}/groups/${G2}`,
        body: { changes: [{ kind: 'set-status', task: { taskId: B }, status: 'on-hold' }] },
      },
      { method: 'DELETE', path: `/api/proposals/${P1}/groups/${G1}`, body: undefined },
    ])
  })

  it("shows the API's refusal, and keeps the group open", async () => {
    const message = "Only the project's read-write members and admins can edit or reject a proposal"
    fakeApi(
      editableAnswers([], {
        status: 403,
        body: { statusCode: 403, error: 'Forbidden', message },
      }),
    )
    renderAt(`/proposals/${P1}`)
    const group1 = await screen.findByRole('listitem', { name: 'Group 1' })
    fireEvent.click(within(group1).getByRole('button', { name: 'Edit group' }))
    const form = screen.getByRole('form', { name: 'Edit group 1' })
    fireEvent.click(within(form).getByRole('button', { name: 'Save group' }))
    expect(await within(form).findByRole('alert')).toHaveTextContent(message)
  })

  it('sends an emptied number field as none', async () => {
    const requests = fakeApi(
      answers({
        [`/api/proposals/${P1}`]: {
          status: 200,
          body: {
            ...proposal,
            groups: [{ id: G1, changes: [{ ...move, fields: { durationWorkingDays: 3 } }] }],
          },
        },
      }),
    )
    renderAt(`/proposals/${P1}`)
    fireEvent.click(await screen.findByRole('button', { name: 'Edit group' }))
    const form = screen.getByRole('form', { name: 'Edit group 1' })
    fireEvent.change(within(form).getByLabelText('Duration in working days'), {
      target: { value: '' },
    })
    fireEvent.click(within(form).getByRole('button', { name: 'Save group' }))
    await waitFor(() => expect(requests.some((r) => r.method === 'PUT')).toBe(true))
    expect(requests.find((r) => r.method === 'PUT')?.body).toEqual({
      changes: [
        { kind: 'update-task', task: { taskId: A }, fields: { durationWorkingDays: null } },
      ],
    })
  })

  it('offers no edit to a proposal that no longer waits for review', async () => {
    fakeApi(
      answers({
        [`/api/proposals/${P1}`]: { status: 200, body: { ...editable, status: 'rejected' } },
        [`/api/proposals/${P1}/conflicts`]: {
          status: 200,
          body: { proposalId: P1, conflicts: [conflict] },
        },
      }),
    )
    renderAt(`/proposals/${P1}`)
    await screen.findByRole('list', { name: 'Conflicts' })
    expect(screen.queryByRole('button', { name: /Edit group|Drop|Resolve/ })).toBeNull()
  })
})

describe('the proposal approve and reject controls (SC-072)', () => {
  /** The answers of a proposal whose approval answers `approval`, and whose plan is `tasks`. */
  function reviewAnswers(
    approval: (count: number) => FakeAnswer,
    tasks: (count: number) => unknown[] = () => [task(A, 'A'), task(B, 'B')],
  ) {
    let approvals = 0
    let reads = 0
    const base = answers()
    return (method: string, path: string): FakeAnswer => {
      if (method === 'POST' && path === `/api/proposals/${P1}/approval`) {
        approvals += 1
        return approval(approvals)
      }
      if (path === `/api/projects/${APOLLO}/tasks`) {
        reads += 1
        return { status: 200, body: tasks(reads) }
      }
      return base(method, path)
    }
  }

  it('approves the proposal against the version of the plan its preview shows', async () => {
    const requests = fakeApi(
      reviewAnswers(() => ({
        status: 200,
        body: {
          outcome: 'applied',
          proposal: {
            ...proposal,
            status: 'approved',
            approvals: [{ projectId: APOLLO, approvedBy: BOB, channel: 'ui', approvedAt: '' }],
          },
        },
      })),
    )
    renderAt(`/proposals/${P1}`)
    const review = await screen.findByRole('region', { name: 'Review' })
    fireEvent.click(within(review).getByRole('button', { name: 'Approve' }))
    await waitFor(() =>
      expect(requests.filter((r) => r.method === 'POST')).toEqual([
        {
          method: 'POST',
          path: `/api/proposals/${P1}/approval`,
          body: { projectId: APOLLO, planVersion: 'v1' },
        },
      ]),
    )
  })

  it('shows who approved a part, and offers nothing to a proposal no longer waiting', async () => {
    fakeApi(
      answers({
        [`/api/proposals/${P1}`]: {
          status: 200,
          body: {
            ...proposal,
            status: 'approved',
            approvals: [{ projectId: APOLLO, approvedBy: BOB, channel: 'ui', approvedAt: '' }],
          },
        },
      }),
    )
    renderAt(`/proposals/${P1}`)
    const review = await screen.findByRole('region', { name: 'Review' })
    expect(review).toHaveTextContent('Approved by bob')
    expect(within(review).queryByRole('button')).toBeNull()
    expect(screen.getByText('Approved')).toBeInTheDocument()
  })

  it('asks to confirm again when the plan changed, showing what changed in it', async () => {
    const requests = fakeApi(
      reviewAnswers(
        (count) => ({
          status: 200,
          body:
            count === 1
              ? { outcome: 'confirm-again', proposal, preview: { ...preview, planVersion: 'v2' } }
              : { outcome: 'applied', proposal: { ...proposal, status: 'approved' } },
        }),
        (reads) => [task(A, 'A'), task(B, 'B', reads > 1 ? { plannedStart: '2027-03-02' } : {})],
      ),
    )
    renderAt(`/proposals/${P1}`)
    const review = await screen.findByRole('region', { name: 'Review' })
    fireEvent.click(within(review).getByRole('button', { name: 'Approve' }))

    const again = await within(review).findByRole('alert')
    expect(again).toHaveTextContent('The plan changed since you opened this preview')
    // Once the plan is read again, the notice lists what changed in it.
    expect(
      await within(again).findByRole('list', { name: 'Changed in the plan' }),
    ).toHaveTextContent('B: start 1 Mar 2027 → 2 Mar 2027')
    // The preview was read again: the confirmation goes against the version it now shows.
    fireEvent.click(within(review).getByRole('button', { name: 'Confirm and approve' }))
    await waitFor(() =>
      expect(requests.filter((r) => r.method === 'POST').map((r) => r.body)).toHaveLength(2),
    )
    expect(requests.filter((r) => r.method === 'POST').map((r) => r.body)).toEqual([
      { projectId: APOLLO, planVersion: 'v1' },
      { projectId: APOLLO, planVersion: 'v1' },
    ])
  })

  it('rejects the proposal after a second click to confirm', async () => {
    const requests = fakeApi(answers())
    renderAt(`/proposals/${P1}`)
    const review = await screen.findByRole('region', { name: 'Review' })
    fireEvent.click(within(review).getByRole('button', { name: 'Reject proposal' }))
    expect(requests.some((r) => r.method === 'POST')).toBe(false)
    fireEvent.click(within(review).getByRole('button', { name: 'Cancel' }))
    fireEvent.click(within(review).getByRole('button', { name: 'Reject proposal' }))
    fireEvent.click(within(review).getByRole('button', { name: 'Yes, reject' }))
    await waitFor(() =>
      expect(requests.filter((r) => r.method === 'POST')).toEqual([
        { method: 'POST', path: `/api/proposals/${P1}/rejection`, body: {} },
      ]),
    )
  })

  it("shows the API's refusal of an approval", async () => {
    const message = "Only the project's read-write members and admins can approve its part"
    fakeApi(
      reviewAnswers(() => ({
        status: 403,
        body: { statusCode: 403, error: 'Forbidden', message },
      })),
    )
    renderAt(`/proposals/${P1}`)
    const review = await screen.findByRole('region', { name: 'Review' })
    fireEvent.click(within(review).getByRole('button', { name: 'Approve' }))
    expect(await within(review).findByRole('alert')).toHaveTextContent(message)
  })
})

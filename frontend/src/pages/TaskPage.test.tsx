import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { fakeApi, type FakeAnswer, type FakeRequest } from '../test/fetch.ts'
import { TaskPage } from './TaskPage.tsx'

const APOLLO = '00000000-0000-4000-8000-000000000001'
const ALICE = '00000000-0000-4000-8000-0000000000a1'
const BOB = '00000000-0000-4000-8000-0000000000b1'
const CAROL = '00000000-0000-4000-8000-0000000000c1'
const DAVE = '00000000-0000-4000-8000-0000000000d1'
const T = '00000000-0000-4000-8000-00000000000a'

const NAMES: Record<string, string> = {
  [ALICE]: 'alice',
  [BOB]: 'bob',
  [CAROL]: 'carol',
  [DAVE]: 'dave',
}

type Task = Record<string, unknown> & {
  eligibility: unknown
  assignees: string[]
  loadOverrides: Record<string, number>
  withoutReadAccess: string[]
}

function baseTask(fields: Partial<Task> = {}): Task {
  return {
    id: T,
    projectId: APOLLO,
    title: 'Write guide',
    description: '',
    status: 'not-started',
    plannedStart: null,
    plannedFinish: null,
    durationWorkingDays: null,
    effort: null,
    repositoryId: null,
    githubIssue: null,
    aiShare: null,
    personLoad: 100,
    milestone: null,
    eligibility: null,
    assignees: [],
    loadOverrides: {},
    withoutReadAccess: [],
    ...fields,
  }
}

const TC_REPO = '00000000-0000-4000-8000-0000000000e1'
const REPOSITORIES = [{ id: TC_REPO, githubId: 1, owner: 'csillagu', name: 'tc-repo' }]

const notFound: FakeAnswer = {
  status: 404,
  body: { statusCode: 404, error: 'Not Found', message: 'Not found' },
}

/**
 * A fake API holding one task in Apollo, whose members are `members`, which applies the changes
 * it is sent, or refuses them with `refusal`.
 */
function serve(
  task: Task,
  members: string[] = [ALICE, BOB, CAROL, DAVE],
  refusal?: FakeAnswer,
): { requests: FakeRequest[]; task: () => Task } {
  let current = task
  const requests = fakeApi((method, path) => {
    if (method === 'GET' && path === `/api/tasks/${T}`) return { status: 200, body: current }
    if (method === 'GET' && path === `/api/projects/${APOLLO}`) {
      return { status: 200, body: { id: APOLLO, name: 'Apollo' } }
    }
    if (method === 'GET' && path === `/api/projects/${APOLLO}/members`) {
      return {
        status: 200,
        body: members.map((id) => ({ accountId: id, username: NAMES[id], role: 'read-only' })),
      }
    }
    if (method === 'GET' && path === `/api/tasks/${T}/people`) {
      const ids = new Set(
        [...JSON.stringify(current.eligibility).matchAll(/[0-9a-f-]{36}/g)].map((m) => m[0]),
      )
      for (const id of current.assignees) ids.add(id)
      return {
        status: 200,
        body: [...ids].map((id) => ({
          accountId: id,
          username: NAMES[id],
          canReadProject: !current.withoutReadAccess.includes(id),
        })),
      }
    }
    if (method === 'GET' && path === `/api/projects/${APOLLO}/repositories`) {
      return { status: 200, body: REPOSITORIES }
    }
    if (method === 'POST' && path === `/api/tasks/${T}/cancel`) {
      if (refusal) return refusal
      current = { ...current, status: 'cancelled' }
      return { status: 200, body: current }
    }
    if (method === 'PUT' && path === `/api/tasks/${T}/repository`) {
      if (refusal) return refusal
      const body = requests.at(-1)?.body
      if (typeof body === 'object' && body !== null && 'repositoryId' in body) {
        current = { ...current, repositoryId: String(body.repositoryId) }
      }
      return { status: 200, body: current }
    }
    if (method === 'PATCH' && path === `/api/tasks/${T}`) {
      if (refusal) return refusal
      const body = requests.at(-1)?.body
      if (typeof body === 'object' && body !== null) current = { ...current, ...body }
      return { status: 200, body: current }
    }
    return notFound
  })
  return { requests, task: () => current }
}

function renderPage() {
  return render(
    <MemoryRouter initialEntries={[`/tasks/${T}`]}>
      <Routes>
        <Route path="/tasks/:taskId" element={<TaskPage />} />
        <Route path="/sign-in" element={<p>Sign-in page</p>} />
      </Routes>
    </MemoryRouter>,
  )
}

afterEach(() => vi.unstubAllGlobals())

const eligibility = () => screen.getByRole('group', { name: 'Eligibility' })
const assignment = () => screen.getByRole('group', { name: 'Assigned people' })
const pick = (label: string, id: string, within_: HTMLElement) =>
  fireEvent.change(within(within_).getByRole('combobox', { name: label }), {
    target: { value: id },
  })
const patches = (requests: FakeRequest[]) => requests.filter((r) => r.method === 'PATCH')

describe('the eligibility expression editor (SC-099)', () => {
  it('builds alice AND (bob OR carol OR dave) and saves it as built (TC-038)', async () => {
    const { requests } = serve(baseTask())
    renderPage()
    await screen.findByRole('heading', { name: 'Write guide' })

    fireEvent.change(within(eligibility()).getByRole('combobox', { name: 'Top level' }), {
      target: { value: 'all' },
    })
    pick('Add a person to the top level', ALICE, eligibility())
    fireEvent.click(within(eligibility()).getByRole('button', { name: 'Add a group' }))
    for (const id of [BOB, CAROL, DAVE]) pick('Add a person to group 1', id, eligibility())
    expect(within(eligibility()).getByRole('status', { name: 'Expression' })).toHaveTextContent(
      'alice AND (bob OR carol OR dave)',
    )
    fireEvent.click(screen.getByRole('button', { name: 'Save eligibility' }))

    await waitFor(() => expect(patches(requests)).toHaveLength(1))
    expect(patches(requests)[0]?.body).toEqual({
      eligibility: { all: [ALICE, { any: [BOB, CAROL, DAVE] }] },
    })
  })

  it('builds (alice AND bob) OR carol (TC-038)', async () => {
    const { requests } = serve(baseTask())
    renderPage()
    await screen.findByRole('heading', { name: 'Write guide' })

    fireEvent.click(within(eligibility()).getByRole('button', { name: 'Add a group' }))
    fireEvent.change(within(eligibility()).getByRole('combobox', { name: 'Group 1' }), {
      target: { value: 'all' },
    })
    pick('Add a person to group 1', ALICE, eligibility())
    pick('Add a person to group 1', BOB, eligibility())
    pick('Add a person to the top level', CAROL, eligibility())
    fireEvent.click(screen.getByRole('button', { name: 'Save eligibility' }))

    await waitFor(() => expect(patches(requests)).toHaveLength(1))
    expect(patches(requests)[0]?.body).toEqual({
      eligibility: { any: [{ all: [ALICE, BOB] }, CAROL] },
    })
  })

  it('offers no way to put a group in a group, so nothing deeper than two levels is built (TC-272)', async () => {
    serve(baseTask({ eligibility: { all: [ALICE, { any: [BOB] }] } }))
    renderPage()
    await screen.findByRole('heading', { name: 'Write guide' })

    const group = within(eligibility()).getByRole('listitem', { name: 'Group 1' })
    expect(within(group).queryByRole('button', { name: /group/i })).toHaveTextContent(
      'Remove group 1',
    )
    expect(within(eligibility()).getAllByRole('button', { name: 'Add a group' })).toHaveLength(1)
  })

  it('refuses to save an empty group, sending nothing', async () => {
    const { requests } = serve(baseTask())
    renderPage()
    await screen.findByRole('heading', { name: 'Write guide' })

    fireEvent.click(within(eligibility()).getByRole('button', { name: 'Add a group' }))
    fireEvent.click(screen.getByRole('button', { name: 'Save eligibility' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Each group needs at least one person.',
    )
    expect(patches(requests)).toHaveLength(0)
  })

  it("shows the API's refusal, and keeps the task as it was", async () => {
    serve(baseTask(), undefined, {
      status: 400,
      body: { statusCode: 400, error: 'Bad Request', message: 'Refused for a reason' },
    })
    renderPage()
    await screen.findByRole('heading', { name: 'Write guide' })
    pick('Add a person to the top level', ALICE, eligibility())
    fireEvent.click(screen.getByRole('button', { name: 'Save eligibility' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Refused for a reason')
  })
})

describe('the marks of people who cannot read the project (FR-199)', () => {
  it('marks bob, and only bob, in the eligibility and the assignment (TC-274)', async () => {
    serve(
      baseTask({
        eligibility: { any: [ALICE, BOB, CAROL] },
        assignees: [BOB, CAROL],
        withoutReadAccess: [BOB],
      }),
      [ALICE, CAROL],
    )
    renderPage()
    await screen.findByRole('heading', { name: 'Write guide' })

    for (const editor of [eligibility(), assignment()]) {
      const bob = within(editor).getByRole('listitem', { name: 'bob' })
      expect(bob).toHaveTextContent('Cannot read Apollo')
      const carol = within(editor).getByRole('listitem', { name: 'carol' })
      expect(carol).not.toHaveTextContent('Cannot read')
    }
    expect(within(eligibility()).getByRole('listitem', { name: 'alice' })).not.toHaveTextContent(
      'Cannot read',
    )
  })
})

describe('the assignment editor (SC-100)', () => {
  it('assigns someone outside the eligibility, with no warning (TC-040)', async () => {
    const { requests } = serve(baseTask({ eligibility: { any: [ALICE, BOB] } }))
    renderPage()
    await screen.findByRole('heading', { name: 'Write guide' })

    pick('Assign a person', CAROL, assignment())
    fireEvent.click(screen.getByRole('button', { name: 'Save assignment' }))
    await waitFor(() => expect(patches(requests)).toHaveLength(1))
    expect(patches(requests)[0]?.body).toEqual({ assignees: [CAROL] })
    await waitFor(() =>
      expect(within(assignment()).getByRole('listitem', { name: 'carol' })).toBeInTheDocument(),
    )
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('does not offer someone already assigned again (TC-275)', async () => {
    serve(baseTask({ assignees: [ALICE] }))
    renderPage()
    await screen.findByRole('heading', { name: 'Write guide' })

    const options = within(
      within(assignment()).getByRole('combobox', { name: 'Assign a person' }),
    ).getAllByRole('option')
    expect(options.map((option) => option.textContent)).toEqual([
      'Add a person…',
      'bob',
      'carol',
      'dave',
    ])
  })

  it("overrides one person's load, leaving the other on the task's (TC-045)", async () => {
    const { requests } = serve(baseTask({ assignees: [ALICE, BOB] }))
    renderPage()
    await screen.findByRole('heading', { name: 'Write guide' })

    const bobLoad = within(assignment()).getByRole('spinbutton', { name: 'Load of bob in percent' })
    expect(bobLoad).toHaveAttribute('placeholder', '100')
    fireEvent.change(
      within(assignment()).getByRole('spinbutton', { name: 'Load of alice in percent' }),
      {
        target: { value: '30' },
      },
    )
    fireEvent.click(screen.getByRole('button', { name: 'Save assignment' }))
    await waitFor(() => expect(patches(requests)).toHaveLength(1))
    expect(patches(requests)[0]?.body).toEqual({ loadOverrides: { [ALICE]: 30 } })
  })

  it("sets an AI-only task's own load to 0, a fraction or over 100 (TC-220)", async () => {
    const { requests } = serve(baseTask({ aiShare: 100, personLoad: 0, assignees: [ALICE] }))
    renderPage()
    await screen.findByRole('heading', { name: 'Write guide' })

    for (const [index, value] of ['0.5', '150', '0'].entries()) {
      const field = await screen.findByRole('spinbutton', { name: 'Person load in percent' })
      fireEvent.change(field, { target: { value } })
      fireEvent.click(screen.getByRole('button', { name: 'Save assignment' }))
      await waitFor(() => expect(patches(requests)).toHaveLength(index + 1))
      expect(patches(requests)[index]?.body).toEqual({ personLoad: Number(value) })
    }
  })

  it('shows no person-load field for a task that is not AI-only', async () => {
    serve(baseTask({ aiShare: 50, personLoad: 50 }))
    renderPage()
    await screen.findByRole('heading', { name: 'Write guide' })
    expect(
      screen.queryByRole('spinbutton', { name: 'Person load in percent' }),
    ).not.toBeInTheDocument()
  })
})

describe('a task the editors do not apply to', () => {
  it('says a milestone has no one to do it, and shows no editor', async () => {
    serve(baseTask({ milestone: { variant: 'floating', date: null }, personLoad: null }))
    renderPage()
    expect(await screen.findByText(/A milestone takes no time/)).toBeInTheDocument()
    expect(screen.queryByRole('group', { name: 'Eligibility' })).not.toBeInTheDocument()
  })

  it('says a task the person cannot see is not visible', async () => {
    fakeApi(() => ({
      status: 403,
      body: {
        statusCode: 403,
        error: 'Not Visible',
        message: 'This project is not visible to you',
      },
    }))
    renderPage()
    expect(await screen.findByRole('alert')).toHaveTextContent('This project is not visible to you')
  })
})

describe('the task details editor (SC-098)', () => {
  it("shows the task's fields and saves only what was changed (TC-170)", async () => {
    const { requests } = serve(
      baseTask({
        title: 'Draft',
        description: 'First pass',
        plannedStart: '2027-03-04',
        plannedFinish: '2027-03-08',
        durationWorkingDays: 3,
      }),
    )
    renderPage()
    await screen.findByRole('heading', { name: 'Draft', level: 1 })
    const details = screen.getByRole('form', { name: 'Details' })
    expect(within(details).getByLabelText('Description')).toHaveValue('First pass')
    expect(within(details).getByLabelText('Duration in working days')).toHaveValue(3)
    // With a duration, the finish is the scheduler's: no field for it.
    expect(within(details).queryByLabelText('Planned finish')).not.toBeInTheDocument()

    fireEvent.change(within(details).getByLabelText('Title'), { target: { value: 'Final' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save details' }))
    await waitFor(() => expect(patches(requests)).toHaveLength(1))
    expect(patches(requests)[0]?.body).toEqual({ title: 'Final' })
    expect(await screen.findByRole('heading', { name: 'Final', level: 1 })).toBeInTheDocument()
  })

  it('refuses a duration that is not whole working days, sending nothing (TC-002)', async () => {
    const { requests } = serve(baseTask({ durationWorkingDays: 3 }))
    renderPage()
    const details = await screen.findByRole('form', { name: 'Details' })
    fireEvent.change(within(details).getByLabelText('Duration in working days'), {
      target: { value: '2.5' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Save details' }))
    expect(await within(details).findByRole('alert')).toHaveTextContent(
      'The duration is a whole number of working days, 1 or more.',
    )
    expect(patches(requests)).toHaveLength(0)
  })

  it('clears the planned dates, leaving the task unscheduled (TC-003)', async () => {
    const { requests } = serve(
      baseTask({ plannedStart: '2027-03-04', plannedFinish: '2027-03-08', durationWorkingDays: 3 }),
    )
    renderPage()
    const details = await screen.findByRole('form', { name: 'Details' })
    fireEvent.click(within(details).getByRole('button', { name: 'Clear the planned dates' }))
    expect(within(details).getByText(/No planned dates/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Save details' }))
    await waitFor(() => expect(patches(requests)).toHaveLength(1))
    expect(patches(requests)[0]?.body).toEqual({
      plannedStart: null,
      durationWorkingDays: null,
      plannedFinish: null,
    })
  })

  it("shows the API's refusal", async () => {
    serve(baseTask(), undefined, {
      status: 403,
      body: { statusCode: 403, error: 'Forbidden', message: 'Read-only members cannot change it' },
    })
    renderPage()
    const details = await screen.findByRole('form', { name: 'Details' })
    fireEvent.change(within(details).getByLabelText('Effort'), { target: { value: '5' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save details' }))
    expect(await within(details).findByRole('alert')).toHaveTextContent(
      'Read-only members cannot change it',
    )
  })

  it("has only a milestone's title and description", async () => {
    serve(baseTask({ milestone: { variant: 'floating', date: null }, personLoad: null }))
    renderPage()
    const details = await screen.findByRole('form', { name: 'Details' })
    expect(within(details).getByLabelText('Title')).toBeInTheDocument()
    expect(within(details).queryByLabelText('Planned start')).not.toBeInTheDocument()
  })

  it('assigns the task to a repository its project pulls issues from (TC-208)', async () => {
    const { requests } = serve(baseTask())
    renderPage()
    const repository = await screen.findByRole('form', { name: 'Repository' })
    const choice = await within(repository).findByRole('combobox', { name: 'Repository' })
    expect(
      within(choice)
        .getAllByRole('option')
        .map((option) => option.textContent),
    ).toEqual(['None', 'csillagu/tc-repo'])
    fireEvent.change(choice, { target: { value: TC_REPO } })
    fireEvent.click(screen.getByRole('button', { name: 'Assign to repository' }))
    await waitFor(() =>
      expect(requests.filter((r) => r.method === 'PUT').map((r) => r.body)).toEqual([
        { repositoryId: TC_REPO },
      ]),
    )
    // Once assigned, "None" is no longer offered (the section is drawn again from the task).
    await waitFor(() =>
      expect(
        within(screen.getByRole('combobox', { name: 'Repository' }))
          .getAllByRole('option')
          .map((option) => option.textContent),
      ).toEqual(['csillagu/tc-repo']),
    )
  })
})

describe('the task cancel action (SC-102)', () => {
  it('cancels the task once confirmed, and shows it cancelled (TC-037)', async () => {
    const { requests } = serve(baseTask())
    renderPage()
    const status = await screen.findByRole('region', { name: 'Status' })
    expect(within(status).getByLabelText('Status: Not started')).toBeInTheDocument()
    fireEvent.click(within(status).getByRole('button', { name: 'Cancel task' }))
    expect(
      within(status).getByText('Cancel Write guide? It stays in Apollo, cancelled.'),
    ).toBeInTheDocument()
    fireEvent.click(within(status).getByRole('button', { name: 'Cancel the task' }))
    // The section is drawn again from the task read back.
    expect(await screen.findByLabelText('Status: Cancelled')).toBeInTheDocument()
    expect(requests.filter((r) => r.method === 'POST').map((r) => r.path)).toEqual([
      `/api/tasks/${T}/cancel`,
    ])
    expect(screen.queryByRole('button', { name: 'Cancel task' })).not.toBeInTheDocument()
  })

  it('sends nothing when kept', async () => {
    const { requests } = serve(baseTask())
    renderPage()
    const status = await screen.findByRole('region', { name: 'Status' })
    fireEvent.click(within(status).getByRole('button', { name: 'Cancel task' }))
    fireEvent.click(within(status).getByRole('button', { name: 'Keep it' }))
    expect(within(status).getByRole('button', { name: 'Cancel task' })).toBeInTheDocument()
    expect(requests.filter((r) => r.method === 'POST')).toHaveLength(0)
  })

  it('offers no cancelling for a finished task', async () => {
    serve(baseTask({ status: 'done' }))
    renderPage()
    const status = await screen.findByRole('region', { name: 'Status' })
    expect(within(status).queryByRole('button', { name: 'Cancel task' })).not.toBeInTheDocument()
  })

  it("shows the API's refusal", async () => {
    serve(baseTask(), undefined, {
      status: 403,
      body: { statusCode: 403, error: 'Forbidden', message: 'Only read-write members can cancel' },
    })
    renderPage()
    const status = await screen.findByRole('region', { name: 'Status' })
    fireEvent.click(within(status).getByRole('button', { name: 'Cancel task' }))
    fireEvent.click(within(status).getByRole('button', { name: 'Cancel the task' }))
    expect(await within(status).findByRole('alert')).toHaveTextContent(
      'Only read-write members can cancel',
    )
  })
})

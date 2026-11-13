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

import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { fakeApi, type FakeAnswer, UNAUTHENTICATED } from '../test/fetch.ts'
import { ProjectPage } from './ProjectPage.tsx'
import { VariancePage } from './VariancePage.tsx'

const APOLLO = '00000000-0000-4000-8000-000000000001'
const T = '00000000-0000-4000-8000-00000000000a'
const BACKLOG = '00000000-0000-4000-8000-00000000000b'
const V1 = '00000000-0000-4000-8000-0000000000b1'
const V2 = '00000000-0000-4000-8000-0000000000b2'

const baseTask = {
  projectId: APOLLO,
  status: 'not-started',
  plannedStart: null,
  plannedFinish: null,
  durationWorkingDays: null,
  aiShare: null,
  milestone: null,
  assignees: [],
  actualFinish: null,
}

const v1 = { id: V1, projectId: APOLLO, name: 'v1', savedAt: '2027-02-26T10:00:00.000Z' }
const v2 = { id: V2, projectId: APOLLO, name: 'v2', savedAt: '2027-03-05T10:00:00.000Z' }

const varianceOf = (baseline: typeof v1, start: string, finish: string) => ({
  baseline,
  tasks: [
    {
      taskId: T,
      title: 'T',
      milestone: false,
      baseline: { start, finish },
      planned: { start: '2027-03-08', finish: '2027-03-10' },
      actual: { start: null, finish: null },
      variance: { start: 5, finish: 5 },
    },
    {
      taskId: BACKLOG,
      title: 'Triage backlog',
      milestone: false,
      baseline: null,
      planned: { start: null, finish: null },
      actual: { start: null, finish: null },
      variance: { start: null, finish: null },
    },
  ],
})

const notFound: FakeAnswer = {
  status: 404,
  body: { statusCode: 404, error: 'Not Found', message: 'Not found' },
}

function fakeProject(overrides: Record<string, FakeAnswer> = {}, baselines = [v1, v2]) {
  return fakeApi((method, path) => {
    const override = overrides[`${method} ${path}`]
    if (override) return override
    switch (path) {
      case `/api/projects/${APOLLO}`:
        return { status: 200, body: { id: APOLLO, name: 'Apollo' } }
      case `/api/projects/${APOLLO}/tasks`:
        return {
          status: 200,
          body: [
            {
              ...baseTask,
              id: T,
              title: 'T',
              plannedStart: '2027-03-08',
              plannedFinish: '2027-03-10',
            },
            { ...baseTask, id: BACKLOG, title: 'Triage backlog' },
          ],
        }
      case `/api/projects/${APOLLO}/task-relations`:
        return {
          status: 200,
          body: [
            { taskId: T, parent: null, blockedBy: [] },
            { taskId: BACKLOG, parent: null, blockedBy: [] },
          ],
        }
      case `/api/projects/${APOLLO}/baselines`:
        return { status: 200, body: baselines }
      case `/api/baselines/${V1}/variance`:
        return { status: 200, body: varianceOf(v1, '2027-03-01', '2027-03-03') }
      case `/api/baselines/${V2}/variance`:
        return { status: 200, body: varianceOf(v2, '2027-03-02', '2027-03-04') }
      default:
        return notFound
    }
  })
}

function renderView() {
  render(
    <MemoryRouter initialEntries={[`/projects/${APOLLO}/variance`]}>
      <Routes>
        <Route path="/sign-in" element={<h1>Sign in</h1>} />
        <Route path="/projects/:projectId" element={<ProjectPage />}>
          <Route path="variance" element={<VariancePage />} />
        </Route>
      </Routes>
    </MemoryRouter>,
  )
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('the baseline variance view (SC-033)', () => {
  it('shows planned, baseline and actual dates side by side against the last baseline', async () => {
    fakeProject()
    renderView()

    const table = await screen.findByRole('table', {
      name: 'Baseline variance of Apollo against v2',
    })
    expect(screen.getByRole('link', { name: 'Baseline variance' })).toHaveAttribute(
      'aria-current',
      'page',
    )
    expect(screen.getByRole('combobox', { name: 'Baseline' })).toHaveValue(V2)
    const cells = within(within(table).getByRole('row', { name: 'T' })).getAllByRole('cell')
    expect(cells.slice(1, 6).map((cell) => cell.textContent)).toEqual([
      '8–10 Mar',
      '2–4 Mar',
      '—',
      '+5',
      '+5',
    ])
    expect(cells[1]).toHaveAttribute('title', '8 Mar 2027 to 10 Mar 2027')
  })

  it('shows unscheduled tasks in a group of their own (FR-004)', async () => {
    fakeProject()
    renderView()
    const table = await screen.findByRole('table', { name: /^Baseline variance of Apollo/ })
    expect(within(table).getByRole('rowheader', { name: /^Unscheduled/ })).toBeInTheDocument()
    const row = within(table).getByRole('row', { name: 'Triage backlog' })
    expect(
      within(row)
        .getAllByRole('cell')
        .slice(1, 6)
        .map((cell) => cell.textContent),
    ).toEqual(['—', '—', '—', '—', '—'])
  })

  it('compares against another baseline when one is selected, and reads only', async () => {
    const requests = fakeProject()
    renderView()
    fireEvent.change(await screen.findByRole('combobox', { name: 'Baseline' }), {
      target: { value: V1 },
    })
    const table = await screen.findByRole('table', {
      name: 'Baseline variance of Apollo against v1',
    })
    expect(within(table).getByRole('columnheader', { name: 'Baseline v1' })).toBeInTheDocument()
    const row = within(table).getByRole('row', { name: 'T' })
    expect(within(row).getAllByRole('cell')[2]).toHaveTextContent('1–3 Mar')
    // It offers nothing to edit (FR-052), and has asked for no change.
    expect(within(table).queryAllByRole('textbox')).toHaveLength(0)
    expect(within(table).queryAllByRole('button')).toHaveLength(0)
    expect(requests.filter((request) => request.method !== 'GET')).toEqual([])
  })

  it('says so when the project has no baseline yet', async () => {
    fakeProject({}, [])
    renderView()
    expect(await screen.findByText(/No baseline of Apollo has been saved yet/)).toBeInTheDocument()
    expect(screen.queryByRole('table')).toBeNull()
  })

  it('leads to the sign-in page when no one is signed in', async () => {
    fakeProject({ [`GET /api/projects/${APOLLO}/baselines`]: UNAUTHENTICATED })
    renderView()
    expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeInTheDocument()
  })
})

describe('the baseline save dialog (SC-097)', () => {
  it('saves a named baseline and selects it (FR-064, FR-153)', async () => {
    let baselines = [v1]
    const requests = fakeApi((method, path) => {
      if (method === 'POST' && path === `/api/projects/${APOLLO}/baselines`) {
        baselines = [v1, v2]
        return { status: 201, body: { ...v2, tasks: [] } }
      }
      if (path === `/api/projects/${APOLLO}/baselines`) return { status: 200, body: baselines }
      if (path === `/api/projects/${APOLLO}`) {
        return { status: 200, body: { id: APOLLO, name: 'Apollo' } }
      }
      if (path === `/api/projects/${APOLLO}/tasks`) return { status: 200, body: [] }
      if (path === `/api/projects/${APOLLO}/task-relations`) return { status: 200, body: [] }
      if (path === `/api/baselines/${V1}/variance`) {
        return { status: 200, body: { baseline: v1, tasks: [] } }
      }
      if (path === `/api/baselines/${V2}/variance`) {
        return { status: 200, body: { baseline: v2, tasks: [] } }
      }
      return notFound
    })
    renderView()

    fireEvent.click(await screen.findByRole('button', { name: 'Save baseline' }))
    const dialog = screen.getByRole('dialog', { name: 'Save baseline' })
    fireEvent.change(within(dialog).getByLabelText('Name'), { target: { value: 'v2' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }))

    expect(
      await screen.findByRole('table', { name: 'Baseline variance of Apollo against v2' }),
    ).toBeInTheDocument()
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(requests.find((request) => request.method === 'POST')).toEqual({
      method: 'POST',
      path: `/api/projects/${APOLLO}/baselines`,
      body: { name: 'v2' },
    })
    expect(screen.getByRole('combobox', { name: 'Baseline' })).toHaveValue(V2)
  })

  it("shows the API's refusal to someone without the read-write role (FR-065)", async () => {
    const message = "Only the project's read-write members and admins can save a baseline"
    fakeProject({
      [`POST /api/projects/${APOLLO}/baselines`]: {
        status: 403,
        body: { statusCode: 403, error: 'Forbidden', message },
      },
    })
    renderView()
    fireEvent.click(await screen.findByRole('button', { name: 'Save baseline' }))
    const dialog = screen.getByRole('dialog', { name: 'Save baseline' })
    fireEvent.change(within(dialog).getByLabelText('Name'), { target: { value: "carol's" } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }))
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(message)

    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(screen.getByRole('combobox', { name: 'Baseline' })).toHaveValue(V2)
  })
})

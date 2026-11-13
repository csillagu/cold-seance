import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { fakeApi, type FakeAnswer, UNAUTHENTICATED } from '../test/fetch.ts'
import { GanttPage } from './GanttPage.tsx'
import { ProjectPage } from './ProjectPage.tsx'

const APOLLO = '00000000-0000-4000-8000-000000000001'
const ALICE = '00000000-0000-4000-8000-0000000000a1'
const A = '00000000-0000-4000-8000-00000000000a'
const M = '00000000-0000-4000-8000-00000000000m'
const U = '00000000-0000-4000-8000-00000000000u'
const X = '00000000-0000-4000-8000-00000000000x'
const V1 = '00000000-0000-4000-8000-0000000000b1'

const baseTask = {
  projectId: APOLLO,
  description: '',
  status: 'in-progress',
  effort: null,
  aiShare: 0,
  personLoad: 100,
  eligibility: null,
  loadOverrides: {},
  withoutReadAccess: [],
  actualStart: null,
  actualFinish: null,
  repositoryId: null,
  githubIssue: null,
}

const tasks = [
  {
    ...baseTask,
    id: A,
    title: 'A',
    plannedStart: '2027-03-01',
    plannedFinish: '2027-03-19',
    durationWorkingDays: 15,
    milestone: null,
    assignees: [ALICE],
  },
  {
    ...baseTask,
    id: M,
    title: 'M',
    status: 'not-started',
    plannedStart: null,
    plannedFinish: null,
    durationWorkingDays: null,
    personLoad: null,
    milestone: { variant: 'fixed-date', date: '2027-03-12' },
    assignees: [],
  },
]

function answers(overrides: Record<string, FakeAnswer> = {}) {
  return (_method: string, path: string): FakeAnswer => {
    if (overrides[path]) return overrides[path]
    switch (path) {
      case `/api/projects/${APOLLO}`:
        return { status: 200, body: { id: APOLLO, name: 'Apollo' } }
      case `/api/projects/${APOLLO}/tasks`:
        return { status: 200, body: tasks }
      case `/api/projects/${APOLLO}/red-flags`:
        return {
          status: 200,
          body: [
            {
              id: 'f1',
              kind: 'fixed-date-milestone-pushed',
              projectId: APOLLO,
              raisedAt: '2026-11-12T10:00:00.000Z',
              task: { id: M, projectId: APOLLO },
              blocker: { id: A, projectId: APOLLO },
              crossProject: false,
              start: '2027-03-12',
              blockerFinish: '2027-03-19',
            },
          ],
        }
      case '/api/calendar':
        return { status: 200, body: { weekendDays: ['saturday', 'sunday'], holidays: [] } }
      case `/api/projects/${APOLLO}/baselines`:
        return {
          status: 200,
          body: [{ id: V1, projectId: APOLLO, name: 'v1', savedAt: '2027-02-26T10:00:00.000Z' }],
        }
      case `/api/baselines/${V1}`:
        return {
          status: 200,
          body: {
            id: V1,
            projectId: APOLLO,
            name: 'v1',
            savedAt: '2027-02-26T10:00:00.000Z',
            tasks: [
              { taskId: A, title: 'A', plannedStart: '2027-03-01', plannedFinish: '2027-03-05' },
              { taskId: M, title: 'M', plannedStart: '2027-03-12', plannedFinish: '2027-03-12' },
            ],
          },
        }
      case `/api/projects/${APOLLO}/gantt/mermaid`:
        return {
          status: 200,
          body: { markdown: '```mermaid\ngantt\n    title Apollo\n```\n' },
        }
      case `/api/tasks/${U}/relations`:
        return { status: 200, body: { taskId: U, parent: null, subtasks: [], blockedBy: [] } }
      case `/api/tasks/${X}/relations`:
        return { status: 200, body: { taskId: X, parent: null, subtasks: [], blockedBy: [] } }
      case `/api/projects/${APOLLO}/members`:
        return { status: 200, body: [{ accountId: ALICE, username: 'alice', role: 'admin' }] }
      case `/api/tasks/${A}/relations`:
        return { status: 200, body: { taskId: A, parent: null, subtasks: [], blockedBy: [] } }
      case `/api/tasks/${M}/relations`:
        return {
          status: 200,
          body: {
            taskId: M,
            parent: null,
            subtasks: [],
            blockedBy: [{ id: A, projectId: APOLLO }],
          },
        }
      default:
        return { status: 404, body: { statusCode: 404, error: 'Not Found', message: 'Not found' } }
    }
  }
}

function renderGantt() {
  render(
    <MemoryRouter initialEntries={[`/projects/${APOLLO}/gantt`]}>
      <Routes>
        <Route path="/sign-in" element={<h1>Sign in</h1>} />
        <Route path="/projects/:projectId" element={<ProjectPage />}>
          <Route path="gantt" element={<GanttPage />} />
        </Route>
      </Routes>
    </MemoryRouter>,
  )
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('the Gantt page (SC-031)', () => {
  it("draws the project's tasks, milestone and dependency, with the violation in red", async () => {
    fakeApi(answers())
    renderGantt()

    const gantt = await screen.findByRole('table', { name: 'Gantt of Apollo' })
    expect(screen.getByRole('link', { name: 'Gantt' })).toHaveAttribute('aria-current', 'page')

    const a = within(gantt).getByRole('row', { name: 'A' })
    expect(a).toHaveAttribute('data-red', 'false')
    expect(within(a).getByRole('img', { name: 'A: 1 Mar 2027 to 19 Mar 2027' })).toBeInTheDocument()
    expect(within(a).getByText('AL')).toHaveAttribute('title', 'alice')

    const m = within(gantt).getByRole('row', { name: 'M' })
    expect(m).toHaveAttribute('data-red', 'true')
    expect(
      within(m).getByRole('img', {
        name: 'M: fixed-date milestone on 12 Mar 2027, in red: pushed past its date',
      }),
    ).toBeInTheDocument()
    expect(within(m).getByText('Fixed 12 Mar · pushed: blocker ends 19 Mar')).toBeInTheDocument()

    const dependencies = within(gantt).getByRole('group', { name: 'Dependencies' })
    expect(
      within(dependencies).getByRole('img', {
        name: 'M is blocked by A, in red: it pushes a fixed-date milestone',
      }),
    ).toHaveAttribute('data-red', 'true')

    expect(within(gantt).getByRole('columnheader', { name: '1 Mar 2027' })).toHaveAttribute(
      'data-date',
      '2027-03-01',
    )
  })

  it('says so when the project has no task', async () => {
    fakeApi(answers({ [`/api/projects/${APOLLO}/tasks`]: { status: 200, body: [] } }))
    renderGantt()
    expect(await screen.findByText('This project has no tasks yet.')).toBeInTheDocument()
  })

  const unscheduled = {
    ...baseTask,
    id: U,
    title: 'Triage backlog',
    status: 'not-started',
    plannedStart: null,
    plannedFinish: null,
    durationWorkingDays: null,
    milestone: null,
    assignees: [],
  }
  const cancelled = {
    ...tasks[0],
    id: X,
    title: 'Old export flow',
    status: 'cancelled',
    plannedStart: '2027-03-08',
    plannedFinish: '2027-03-09',
    durationWorkingDays: 2,
    assignees: [],
  }

  it('lays the unscheduled tasks below the scheduled ones, without dates (SC-064)', async () => {
    fakeApi(
      answers({
        [`/api/projects/${APOLLO}/tasks`]: { status: 200, body: [unscheduled, ...tasks] },
      }),
    )
    renderGantt()
    const gantt = await screen.findByRole('table', { name: 'Gantt of Apollo' })
    const rows = within(gantt)
      .getAllByRole('row')
      .map((row) => row.getAttribute('aria-label'))
    expect(rows.slice(1)).toEqual(['A', 'M', 'Unscheduled', 'Triage backlog'])
    const triage = within(gantt).getByRole('row', { name: 'Triage backlog' })
    expect(triage).toHaveAttribute('data-unscheduled', 'true')
    expect(within(triage).getByText('No planned dates')).toBeInTheDocument()
    expect(within(triage).queryByRole('img')).toBeNull()
  })

  it('shows an unscheduled task when no task has dates', async () => {
    fakeApi(answers({ [`/api/projects/${APOLLO}/tasks`]: { status: 200, body: [unscheduled] } }))
    renderGantt()
    const gantt = await screen.findByRole('table', { name: 'Gantt of Apollo' })
    expect(within(gantt).getByRole('row', { name: 'Triage backlog' })).toBeInTheDocument()
  })

  it('draws a cancelled task faded, on its dates (SC-064)', async () => {
    fakeApi(
      answers({ [`/api/projects/${APOLLO}/tasks`]: { status: 200, body: [...tasks, cancelled] } }),
    )
    renderGantt()
    const gantt = await screen.findByRole('table', { name: 'Gantt of Apollo' })
    const row = within(gantt).getByRole('row', { name: 'Old export flow' })
    expect(row).toHaveAttribute('data-cancelled', 'true')
    const bar = within(row).getByRole('img', {
      name: 'Old export flow: 8 Mar 2027 to 9 Mar 2027, cancelled',
    })
    expect(bar).toHaveClass('gantt__bar--cancelled')
    expect(within(gantt).getByRole('row', { name: 'A' })).toHaveAttribute('data-cancelled', 'false')
    expect(
      within(screen.getByRole('list', { name: 'Legend' })).getByText('Cancelled'),
    ).toBeVisible()
  })

  it('draws the bars of a selected baseline, and none without one (SC-065)', async () => {
    const requests = fakeApi(answers())
    renderGantt()
    const gantt = await screen.findByRole('table', { name: 'Gantt of Apollo' })
    expect(within(gantt).queryByRole('img', { name: /^Baseline/ })).toBeNull()

    const select = screen.getByRole('combobox', { name: 'Baseline:' })
    expect(within(select).getByRole('option', { name: 'v1 (26 Feb)' })).toBeInTheDocument()
    fireEvent.change(select, { target: { value: V1 } })

    const a = within(gantt).getByRole('row', { name: 'A' })
    expect(
      await within(a).findByRole('img', { name: 'Baseline v1 of A: 1 Mar 2027 to 5 Mar 2027' }),
    ).toBeInTheDocument()
    // The planned bar is as it was.
    expect(within(a).getByRole('img', { name: 'A: 1 Mar 2027 to 19 Mar 2027' })).toBeInTheDocument()
    expect(
      within(gantt).getByRole('img', { name: 'Baseline v1 of M: 12 Mar 2027 to 12 Mar 2027' }),
    ).toBeInTheDocument()
    expect(
      within(screen.getByRole('list', { name: 'Legend' })).getByText('Baseline v1'),
    ).toBeVisible()
    // Selecting it only reads it.
    expect(requests.filter((request) => request.method !== 'GET')).toEqual([])

    fireEvent.change(select, { target: { value: '' } })
    expect(within(gantt).queryByRole('img', { name: /^Baseline/ })).toBeNull()
  })

  it('says so when the selected baseline cannot be loaded', async () => {
    fakeApi(
      answers({
        [`/api/baselines/${V1}`]: {
          status: 500,
          body: { statusCode: 500, error: 'Internal Server Error', message: 'Failed' },
        },
      }),
    )
    renderGantt()
    await screen.findByRole('table', { name: 'Gantt of Apollo' })
    fireEvent.change(screen.getByRole('combobox', { name: 'Baseline:' }), {
      target: { value: V1 },
    })
    expect(await screen.findByRole('alert')).toHaveTextContent('The baseline could not be loaded.')
  })

  it('exports the Gantt as a Mermaid chart in a dialog (SC-096)', async () => {
    fakeApi(answers())
    renderGantt()
    await screen.findByRole('table', { name: 'Gantt of Apollo' })
    const button = screen.getByRole('button', { name: 'Export as Mermaid' })
    fireEvent.click(button)

    const dialog = screen.getByRole('dialog', { name: 'Export as Mermaid' })
    const text = await within(dialog).findByRole('textbox', { name: 'Mermaid chart' })
    expect(text).toHaveValue('```mermaid\ngantt\n    title Apollo\n```\n')
    expect(text).toHaveAttribute('readonly')

    fireEvent.click(within(dialog).getByRole('button', { name: 'Close' }))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(button).toHaveFocus()
  })

  it('copies the chart, and closes the dialog on Escape', async () => {
    fakeApi(answers())
    const writeText = vi.fn<(text: string) => Promise<void>>(async () => {})
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    renderGantt()
    await screen.findByRole('table', { name: 'Gantt of Apollo' })
    fireEvent.click(screen.getByRole('button', { name: 'Export as Mermaid' }))
    const dialog = screen.getByRole('dialog', { name: 'Export as Mermaid' })
    await within(dialog).findByRole('textbox', { name: 'Mermaid chart' })

    fireEvent.click(within(dialog).getByRole('button', { name: 'Copy' }))
    expect(await within(dialog).findByRole('status')).toHaveTextContent('Copied')
    expect(writeText).toHaveBeenCalledWith('```mermaid\ngantt\n    title Apollo\n```\n')

    fireEvent.keyDown(dialog, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('says so in the dialog when the Gantt cannot be exported', async () => {
    fakeApi(
      answers({
        [`/api/projects/${APOLLO}/gantt/mermaid`]: {
          status: 500,
          body: { statusCode: 500, error: 'Internal Server Error', message: 'Failed' },
        },
      }),
    )
    renderGantt()
    await screen.findByRole('table', { name: 'Gantt of Apollo' })
    fireEvent.click(screen.getByRole('button', { name: 'Export as Mermaid' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('The Gantt could not be exported.')
  })

  it('says so when the Gantt cannot be loaded', async () => {
    fakeApi(
      answers({
        [`/api/projects/${APOLLO}/red-flags`]: {
          status: 500,
          body: { statusCode: 500, error: 'Internal Server Error', message: 'Failed' },
        },
      }),
    )
    renderGantt()
    expect(await screen.findByRole('alert')).toHaveTextContent('The Gantt could not be loaded.')
  })

  it('edits a task in its editor, opened from its title, and reads the Gantt again (SC-067)', async () => {
    const requests = fakeApi((method, path) =>
      method === 'PATCH' ? { status: 200, body: tasks[0] } : answers()(method, path),
    )
    renderGantt()
    const gantt = await screen.findByRole('table', { name: 'Gantt of Apollo' })
    fireEvent.click(within(gantt).getByRole('button', { name: 'Edit A' }))
    const dialog = screen.getByRole('dialog', { name: 'Edit A' })
    fireEvent.change(within(dialog).getByLabelText('Title'), { target: { value: 'A2' } })
    const before = requests.length
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(requests[before]).toEqual({
      method: 'PATCH',
      path: `/api/tasks/${A}`,
      body: { title: 'A2' },
    })
    expect(requests.slice(before + 1).map((request) => request.path)).toContain(
      `/api/projects/${APOLLO}/tasks`,
    )
  })

  it('creates a task in the project with "New task" (SC-067)', async () => {
    const requests = fakeApi((method, path) =>
      method === 'POST' ? { status: 201, body: tasks[0] } : answers()(method, path),
    )
    renderGantt()
    await screen.findByRole('table', { name: 'Gantt of Apollo' })
    fireEvent.click(screen.getByRole('button', { name: 'New task' }))
    const dialog = screen.getByRole('dialog', { name: 'New task' })
    expect(within(dialog).queryByLabelText('Project')).toBeNull()
    fireEvent.change(within(dialog).getByLabelText('Title'), { target: { value: 'New work' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(requests).toContainEqual({
      method: 'POST',
      path: `/api/projects/${APOLLO}/tasks`,
      body: { title: 'New work' },
    })
  })

  it('sends someone who is not signed in to the sign-in page', async () => {
    fakeApi(answers({ [`/api/projects/${APOLLO}/tasks`]: UNAUTHENTICATED }))
    renderGantt()
    expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeInTheDocument()
  })
})

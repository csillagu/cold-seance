import { render, screen, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { fakeApi, type FakeAnswer, UNAUTHENTICATED } from '../test/fetch.ts'
import { GanttPage } from './GanttPage.tsx'
import { ProjectPage } from './ProjectPage.tsx'

const APOLLO = '00000000-0000-4000-8000-000000000001'
const ALICE = '00000000-0000-4000-8000-0000000000a1'
const A = '00000000-0000-4000-8000-00000000000a'
const M = '00000000-0000-4000-8000-00000000000m'

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

  it('says so when no task has planned dates', async () => {
    fakeApi(answers({ [`/api/projects/${APOLLO}/tasks`]: { status: 200, body: [] } }))
    renderGantt()
    expect(
      await screen.findByText('No task of this project has planned dates yet.'),
    ).toBeInTheDocument()
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

  it('sends someone who is not signed in to the sign-in page', async () => {
    fakeApi(answers({ [`/api/projects/${APOLLO}/tasks`]: UNAUTHENTICATED }))
    renderGantt()
    expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeInTheDocument()
  })
})

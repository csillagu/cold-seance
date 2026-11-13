import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { fakeApi, type FakeAnswer, UNAUTHENTICATED } from '../test/fetch.ts'
import { PersonLoadPage } from './PersonLoadPage.tsx'
import { ProjectPage } from './ProjectPage.tsx'

const APOLLO = '00000000-0000-4000-8000-000000000001'
const BOREALIS = '00000000-0000-4000-8000-000000000002'
const HIDDEN = '00000000-0000-4000-8000-000000000003'
const ALICE = '00000000-0000-4000-8000-0000000000a1'
const CAROL = '00000000-0000-4000-8000-0000000000c1'
const T1 = '00000000-0000-4000-8000-00000000000a'
const T2 = '00000000-0000-4000-8000-00000000000b'
const BACKLOG = '00000000-0000-4000-8000-00000000000c'
const U = '00000000-0000-4000-8000-00000000000d'

const SPAN = 'from=2027-03-01&to=2027-03-03'

const baseTask = {
  projectId: APOLLO,
  status: 'not-started',
  plannedStart: '2027-03-01',
  plannedFinish: '2027-03-02',
  durationWorkingDays: 2,
  aiShare: null,
  milestone: null,
  assignees: [CAROL],
}

const t1 = { taskId: T1, projectId: APOLLO, title: 'T1', load: 50 }
const t2 = { taskId: T2, projectId: BOREALIS, title: 'T2', load: 20 }

const loadDay = (date: string, fields: Record<string, unknown>) => ({
  date,
  load: 0,
  tasks: [],
  otherProjects: 0,
  capacity: 80,
  overloaded: false,
  ...fields,
})

const notFound: FakeAnswer = {
  status: 404,
  body: { statusCode: 404, error: 'Not Found', message: 'Not found' },
}

function fakeProject(overrides: Record<string, FakeAnswer> = {}) {
  return fakeApi((method, path) => {
    const override = overrides[`${method} ${path}`]
    if (override) return override
    switch (path) {
      case `/api/projects/${APOLLO}`:
        return { status: 200, body: { id: APOLLO, name: 'Apollo' } }
      case `/api/projects/${BOREALIS}`:
        return { status: 200, body: { id: BOREALIS, name: 'Borealis' } }
      case `/api/projects/${APOLLO}/members`:
        return {
          status: 200,
          body: [
            { accountId: CAROL, username: 'carol', role: 'read-only' },
            { accountId: ALICE, username: 'alice', role: 'admin' },
          ],
        }
      case `/api/projects/${APOLLO}/tasks`:
        return {
          status: 200,
          body: [
            { ...baseTask, id: T1, title: 'T1' },
            {
              ...baseTask,
              id: BACKLOG,
              title: 'Triage backlog',
              plannedStart: null,
              plannedFinish: null,
              durationWorkingDays: null,
              assignees: [ALICE],
            },
            { ...baseTask, id: U, title: 'U', assignees: [] },
          ],
        }
      case `/api/projects/${APOLLO}/unassigned-task-ratings`:
        return {
          status: 200,
          body: [
            {
              taskId: U,
              title: 'U',
              plannedStart: '2027-03-01',
              plannedFinish: '2027-03-05',
              eligibility: { any: [ALICE, CAROL] },
              rating: 'amber',
            },
          ],
        }
      case `/api/accounts/${CAROL}/load?${SPAN}`:
        return {
          status: 200,
          body: {
            accountId: CAROL,
            from: '2027-03-01',
            to: '2027-03-03',
            days: [
              loadDay('2027-03-01', { load: 50, tasks: [t1] }),
              loadDay('2027-03-02', {
                load: 130,
                tasks: [t1, t2],
                otherProjects: 60,
                overloaded: true,
              }),
              loadDay('2027-03-03', {}),
            ],
          },
        }
      case `/api/accounts/${ALICE}/load?${SPAN}`:
        return {
          status: 200,
          body: {
            accountId: ALICE,
            from: '2027-03-01',
            to: '2027-03-03',
            days: ['2027-03-01', '2027-03-02', '2027-03-03'].map((date) =>
              loadDay(date, { capacity: null, overloaded: null }),
            ),
          },
        }
      default:
        return notFound
    }
  })
}

function renderView(query = SPAN) {
  render(
    <MemoryRouter initialEntries={[`/projects/${APOLLO}/load?${query}`]}>
      <Routes>
        <Route path="/sign-in" element={<h1>Sign in</h1>} />
        <Route path="/projects/:projectId" element={<ProjectPage />}>
          <Route path="load" element={<PersonLoadPage />} />
        </Route>
      </Routes>
    </MemoryRouter>,
  )
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('the person load view (SC-032)', () => {
  it("shows each member's daily load against capacity, overloads in red", async () => {
    fakeProject()
    renderView()

    const table = await screen.findByRole('table', { name: 'Person load of Apollo' })
    expect(screen.getByRole('link', { name: 'Person load' })).toHaveAttribute(
      'aria-current',
      'page',
    )
    expect(
      within(table)
        .getAllByRole('rowheader')
        .map((header) => header.textContent),
    ).toEqual([expect.stringMatching(/^Aalice$/), expect.stringMatching(/^Ccarol/)])

    const first = screen.getByRole('button', { name: 'carol, 1 Mar 2027: 50% of 80% capacity' })
    expect(first).not.toHaveClass('load__cell--over')
    const over = screen.getByRole('button', {
      name: 'carol, 2 Mar 2027: 130% of 80% capacity, overloaded',
    })
    expect(over).toHaveClass('load__cell--over')
    // A capacity the viewer may not read is not shown, and no overload is claimed.
    expect(screen.getByRole('button', { name: 'alice, 1 Mar 2027: 0%' })).not.toHaveClass(
      'load__cell--over',
    )

    // The row names the readable tasks behind the load, another project's by its name.
    const tasks = screen.getByRole('list', { name: 'Tasks of carol' })
    expect(within(tasks).getByRole('link', { name: 'T1' })).toHaveAttribute('href', `/tasks/${T1}`)
    expect(within(tasks).getByText(/Borealis/)).toBeInTheDocument()
  })

  it("shows a day's readable tasks by name and the rest as other projects' percentage", async () => {
    fakeProject()
    renderView()
    fireEvent.click(
      await screen.findByRole('button', {
        name: 'carol, 2 Mar 2027: 130% of 80% capacity, overloaded',
      }),
    )
    const details = screen.getByRole('region', { name: 'Load of carol on 2 Mar 2027' })
    expect(details).toHaveTextContent('Total 130% of 80% capacity · Overloaded')
    expect(within(details).getByRole('link', { name: 'T1' })).toBeInTheDocument()
    expect(within(details).getByText('Borealis')).toBeInTheDocument()
    expect(within(details).getByText('Other projects: 60%')).toBeInTheDocument()
    expect(details).not.toHaveTextContent(HIDDEN)

    fireEvent.click(within(details).getByRole('button', { name: 'Close' }))
    expect(screen.queryByRole('region', { name: 'Load of carol on 2 Mar 2027' })).toBeNull()
  })

  it('lists the tasks that put load on no one, unscheduled ones among them', async () => {
    fakeProject()
    renderView()
    const none = await screen.findByRole('region', { name: "Tasks on no one's load" })
    const backlog = within(none).getByRole('article', { name: 'Triage backlog' })
    expect(backlog).toHaveTextContent('No dates, so no load')
    expect(backlog).toHaveTextContent('Assigned to alice')
    // U is rated in the panel, so it is not listed again.
    expect(within(none).queryByRole('article', { name: 'U' })).toBeNull()
  })

  it('reads the span the form asks for, and refuses one that runs backwards', async () => {
    const requests = fakeProject()
    renderView()
    await screen.findByRole('table', { name: 'Person load of Apollo' })

    fireEvent.change(screen.getByLabelText('From'), { target: { value: '2027-03-04' } })
    fireEvent.change(screen.getByLabelText('To'), { target: { value: '2027-03-01' } })
    fireEvent.click(screen.getByRole('button', { name: 'Show' }))
    expect(screen.getByRole('alert')).toHaveTextContent('The first day must not be after the last.')

    fireEvent.change(screen.getByLabelText('To'), { target: { value: '2027-03-05' } })
    fireEvent.click(screen.getByRole('button', { name: 'Show' }))
    await waitFor(() =>
      expect(requests.map((request) => request.path)).toContain(
        `/api/accounts/${CAROL}/load?from=2027-03-04&to=2027-03-05`,
      ),
    )
  })

  it('sends someone not signed in to the sign-in page', async () => {
    fakeProject({ [`GET /api/projects/${APOLLO}/members`]: UNAUTHENTICATED })
    renderView()
    expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeInTheDocument()
  })

  it('says so when the view cannot be loaded', async () => {
    fakeProject({ [`GET /api/projects/${APOLLO}/tasks`]: { status: 500, body: {} } })
    renderView()
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'The person load view could not be loaded.',
    )
  })
})

describe('the unassigned task rating panel (SC-069)', () => {
  it('rates each eligible but unassigned task, in colour and in words', async () => {
    fakeProject()
    renderView()
    const panel = await screen.findByRole('region', { name: 'Unassigned tasks' })
    const u = within(panel).getByRole('article', { name: 'U' })
    expect(within(u).getByText('Amber')).toHaveClass('load__rating--amber')
    expect(u).toHaveTextContent('Some eligible combinations overload someone')
    expect(u).toHaveTextContent('1 Mar – 5 Mar 2027')
    expect(u).toHaveTextContent('Eligible: alice OR carol')
  })

  it('says when no task is waiting for one of its eligible people', async () => {
    fakeProject({
      [`GET /api/projects/${APOLLO}/unassigned-task-ratings`]: { status: 200, body: [] },
    })
    renderView()
    const panel = await screen.findByRole('region', { name: 'Unassigned tasks' })
    expect(panel).toHaveTextContent('No scheduled task is waiting for one of its eligible people.')
    // U is then on no one's load.
    const none = screen.getByRole('region', { name: "Tasks on no one's load" })
    expect(within(none).getByRole('article', { name: 'U' })).toHaveTextContent('No one assigned')
  })
})

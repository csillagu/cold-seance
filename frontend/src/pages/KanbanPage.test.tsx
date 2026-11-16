import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { fakeApi, type FakeAnswer, UNAUTHENTICATED } from '../test/fetch.ts'
import { KanbanPage } from './KanbanPage.tsx'
import { ProjectPage } from './ProjectPage.tsx'

const APOLLO = '00000000-0000-4000-8000-000000000001'
const ALICE = '00000000-0000-4000-8000-0000000000a1'
const BOB = '00000000-0000-4000-8000-0000000000b1'
const T = '00000000-0000-4000-8000-00000000000a'
const U = '00000000-0000-4000-8000-00000000000b'
const X = '00000000-0000-4000-8000-00000000000c'

const baseTask: Record<string, unknown> = {
  projectId: APOLLO,
  description: '',
  status: 'not-started',
  plannedStart: null,
  plannedFinish: null,
  durationWorkingDays: null,
  effort: null,
  aiShare: null,
  personLoad: 100,
  milestone: null,
  eligibility: null,
  assignees: [],
  loadOverrides: {},
  withoutReadAccess: [],
  actualStart: null,
  actualFinish: null,
  repositoryId: null,
  githubIssue: null,
}

type Task = Record<string, unknown> & { id: string; title: string; status?: unknown }

function initialTasks(): Task[] {
  return [
    { ...baseTask, id: U, title: 'Triage backlog' },
    {
      ...baseTask,
      id: T,
      title: 'Write guide',
      plannedStart: '2027-03-01',
      plannedFinish: '2027-03-02',
      durationWorkingDays: 2,
      aiShare: 50,
      assignees: [ALICE],
    },
    { ...baseTask, id: X, title: 'Old flow', status: 'cancelled' },
  ]
}

const notFound: FakeAnswer = {
  status: 404,
  body: { statusCode: 404, error: 'Not Found', message: 'Not found' },
}

/** A fake API holding the tasks, which applies the status changes and edits it is sent. */
function fakeProject(overrides: Record<string, FakeAnswer> = {}) {
  const tasks = initialTasks()
  const requests = fakeApi((method, path) => {
    const override = overrides[`${method} ${path}`]
    if (override) return override
    const sent = requests.at(-1)?.body
    const body: Record<string, unknown> =
      typeof sent === 'object' && sent !== null ? { ...sent } : {}
    const relations = /^\/api\/tasks\/([^/]+)\/relations$/.exec(path)
    if (relations) {
      return {
        status: 200,
        body: { taskId: relations[1], parent: null, subtasks: [], blockedBy: [] },
      }
    }
    const match = /^\/api\/tasks\/([^/]+)(\/status|\/cancel)?$/.exec(path)
    if (match) {
      const found = tasks.find((task) => task.id === match[1])
      if (!found) return notFound
      if (match[2] === '/status') found.status = String(body['status'])
      else if (match[2] === '/cancel') found.status = 'cancelled'
      else Object.assign(found, body)
      return { status: 200, body: found }
    }
    switch (path) {
      case `/api/projects/${APOLLO}`:
        return { status: 200, body: { id: APOLLO, name: 'Apollo', role: 'read-write' } }
      case `/api/projects/${APOLLO}/tasks`:
        return { status: 200, body: tasks }
      case `/api/projects/${APOLLO}/red-flags`:
        return {
          status: 200,
          body: [
            {
              id: 'f1',
              kind: 'assignee-unavailable',
              projectId: APOLLO,
              raisedAt: '2026-11-12T10:00:00.000Z',
              task: { id: T, projectId: APOLLO },
            },
          ],
        }
      case `/api/projects/${APOLLO}/proposals`:
        return { status: 200, body: [] }
      case `/api/projects/${APOLLO}/members`:
        return {
          status: 200,
          body: [
            { accountId: ALICE, username: 'alice', role: 'admin' },
            { accountId: BOB, username: 'bob', role: 'read-write' },
          ],
        }
      default:
        return notFound
    }
  })
  return { tasks, requests }
}

function renderKanban() {
  render(
    <MemoryRouter initialEntries={[`/projects/${APOLLO}/kanban`]}>
      <Routes>
        <Route path="/sign-in" element={<h1>Sign in</h1>} />
        <Route path="/projects/:projectId" element={<ProjectPage />}>
          <Route path="kanban" element={<KanbanPage />} />
        </Route>
      </Routes>
    </MemoryRouter>,
  )
}

const column = (name: string) => screen.getByRole('region', { name })
const card = (title: string) => screen.getByRole('article', { name: title })

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('the Kanban page (SC-030)', () => {
  it('lays the tasks out in their status columns, unscheduled ones at the bottom', async () => {
    fakeProject()
    renderKanban()

    await screen.findByRole('group', { name: 'Kanban of Apollo' })
    expect(screen.getByRole('link', { name: 'Kanban' })).toHaveAttribute('aria-current', 'page')
    expect(
      screen.getAllByRole('region').map((region) => region.getAttribute('data-status')),
    ).toEqual(['not-started', 'in-progress', 'on-hold', 'done', 'cancelled'])

    const notStarted = column('Not started')
    const scheduled = within(notStarted).getByRole('list', { name: 'Not started, scheduled' })
    const unscheduled = within(notStarted).getByRole('list', { name: 'Not started, unscheduled' })
    expect(within(scheduled).getByRole('article', { name: 'Write guide' })).toBeInTheDocument()
    expect(within(unscheduled).getByRole('article', { name: 'Triage backlog' })).toBeInTheDocument()
    expect(within(notStarted).getByRole('separator', { name: 'Unscheduled' })).toBeInTheDocument()

    const guide = card('Write guide')
    expect(guide).toHaveAttribute('data-red', 'true')
    expect(within(guide).getByText('1–2 Mar · 2d')).toBeInTheDocument()
    expect(within(guide).getByText('AI share 50%')).toBeInTheDocument()
    expect(within(guide).getByText('AL')).toHaveAttribute('title', 'alice')
    expect(
      within(guide).getByText('The people assigned cannot do it in its time'),
    ).toBeInTheDocument()

    const triage = card('Triage backlog')
    expect(within(triage).getByText('No dates')).toBeInTheDocument()
    expect(within(triage).getByText('Unassigned')).toBeInTheDocument()

    const old = within(column('Cancelled')).getByRole('article', { name: 'Old flow' })
    expect(within(old).queryByRole('combobox')).toBeNull()
  })

  it('moves a card to another column with its move control, and reads the Kanban again', async () => {
    const { requests } = fakeProject()
    renderKanban()
    await screen.findByRole('group', { name: 'Kanban of Apollo' })

    const select = within(card('Triage backlog')).getByRole('combobox', {
      name: 'Move Triage backlog to',
    })
    expect(
      within(select)
        .getAllByRole('option')
        .map((option) => option.textContent),
    ).toEqual(['Move to…', 'In progress', 'On hold', 'Done', 'Cancelled'])
    fireEvent.change(select, { target: { value: 'in-progress' } })

    await waitFor(() =>
      expect(
        within(column('In progress')).getByRole('article', { name: 'Triage backlog' }),
      ).toBeInTheDocument(),
    )
    expect(requests).toContainEqual({
      method: 'PUT',
      path: `/api/tasks/${U}/status`,
      body: { status: 'in-progress' },
    })
  })

  it('cancels a task moved to the cancelled column', async () => {
    const { requests } = fakeProject()
    renderKanban()
    await screen.findByRole('group', { name: 'Kanban of Apollo' })

    fireEvent.change(
      within(card('Write guide')).getByRole('combobox', { name: 'Move Write guide to' }),
      { target: { value: 'cancelled' } },
    )
    await waitFor(() =>
      expect(
        within(column('Cancelled')).getByRole('article', { name: 'Write guide' }),
      ).toBeInTheDocument(),
    )
    expect(requests).toContainEqual({
      method: 'POST',
      path: `/api/tasks/${T}/cancel`,
      body: {},
    })
  })

  it('moves a card dropped on another column', async () => {
    const { requests } = fakeProject()
    renderKanban()
    await screen.findByRole('group', { name: 'Kanban of Apollo' })

    const dataTransfer = {
      setData: vi.fn<(format: string, data: string) => void>(),
      effectAllowed: '',
    }
    fireEvent.dragStart(card('Triage backlog'), { dataTransfer })
    fireEvent.dragOver(column('On hold'), { dataTransfer })
    fireEvent.drop(column('On hold'), { dataTransfer })

    await waitFor(() =>
      expect(
        within(column('On hold')).getByRole('article', { name: 'Triage backlog' }),
      ).toBeInTheDocument(),
    )
    expect(requests).toContainEqual({
      method: 'PUT',
      path: `/api/tasks/${U}/status`,
      body: { status: 'on-hold' },
    })
  })

  it("opens the task dialog from a card's title, with no Edit or Open button on the card (#209)", async () => {
    fakeProject()
    renderKanban()
    await screen.findByRole('group', { name: 'Kanban of Apollo' })

    expect(within(card('Write guide')).queryByRole('button', { name: /^Edit/ })).toBeNull()
    expect(within(card('Write guide')).queryByRole('link')).toBeNull()
    fireEvent.click(within(card('Write guide')).getByRole('button', { name: 'Open Write guide' }))
    const dialog = screen.getByRole('dialog')
    expect(await within(dialog).findByRole('heading', { name: 'Write guide' })).toBeInTheDocument()
    expect(within(dialog).getByRole('heading', { name: 'Blocked by' })).toBeInTheDocument()
    expect(within(dialog).getByRole('heading', { name: 'Parent' })).toBeInTheDocument()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Close' }))
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('edits the fields a card shows in the task dialog, sending only what changed', async () => {
    const { requests } = fakeProject()
    renderKanban()
    await screen.findByRole('group', { name: 'Kanban of Apollo' })

    fireEvent.click(within(card('Write guide')).getByRole('button', { name: 'Open Write guide' }))
    const form = await screen.findByRole('form', { name: 'Edit Write guide' })
    fireEvent.change(within(form).getByLabelText('Title'), { target: { value: 'Write guide v2' } })
    fireEvent.change(within(form).getByLabelText('Duration in working days'), {
      target: { value: '3' },
    })
    fireEvent.click(within(form).getByLabelText('bob'))
    fireEvent.click(within(form).getByRole('button', { name: 'Save' }))

    expect(await screen.findByRole('article', { name: 'Write guide v2' })).toBeInTheDocument()
    expect(requests).toContainEqual({
      method: 'PATCH',
      path: `/api/tasks/${T}`,
      body: { title: 'Write guide v2', durationWorkingDays: 3, assignees: [ALICE, BOB] },
    })
  })

  it("shows the API's refusal on the card and keeps it where it was", async () => {
    fakeProject({
      [`PUT /api/tasks/${U}/status`]: {
        status: 403,
        body: {
          statusCode: 403,
          error: 'Forbidden',
          message: 'Read-only members cannot change tasks',
        },
      },
    })
    renderKanban()
    await screen.findByRole('group', { name: 'Kanban of Apollo' })

    fireEvent.change(
      within(card('Triage backlog')).getByRole('combobox', { name: 'Move Triage backlog to' }),
      { target: { value: 'in-progress' } },
    )
    expect(await within(card('Triage backlog')).findByRole('alert')).toHaveTextContent(
      'Read-only members cannot change tasks',
    )
    expect(
      within(column('Not started')).getByRole('article', { name: 'Triage backlog' }),
    ).toBeInTheDocument()
  })

  it('says so when the Kanban cannot be loaded', async () => {
    fakeProject({
      [`GET /api/projects/${APOLLO}/red-flags`]: {
        status: 500,
        body: { statusCode: 500, error: 'Internal Server Error', message: 'Failed' },
      },
    })
    renderKanban()
    expect(await screen.findByRole('alert')).toHaveTextContent('The Kanban could not be loaded.')
  })

  it('sends someone who is not signed in to the sign-in page', async () => {
    fakeProject({ [`GET /api/projects/${APOLLO}/tasks`]: UNAUTHENTICATED })
    renderKanban()
    expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeInTheDocument()
  })

  it('shows what a proposal under review would change as pending, apart (FR-073)', async () => {
    const P = '00000000-0000-4000-8000-0000000000c1'
    const NEW = '00000000-0000-4000-8000-0000000000c2'
    const [, guide] = initialTasks()
    const previewed = (fields: Record<string, unknown>) => ({
      ...guide,
      parentId: null,
      blockedBy: [],
      ...fields,
    })
    const requests = fakeProject({
      [`GET /api/projects/${APOLLO}/proposals`]: {
        status: 200,
        body: [{ id: P, status: 'waiting', projectIds: [APOLLO] }],
      },
      [`GET /api/proposals/${P}/preview`]: {
        status: 200,
        body: {
          proposalId: P,
          differences: [
            {
              taskId: T,
              projectId: APOLLO,
              newTask: null,
              before: previewed({}),
              after: previewed({ assignees: [BOB] }),
            },
            {
              taskId: NEW,
              projectId: APOLLO,
              newTask: 'n1',
              before: null,
              after: previewed({
                id: NEW,
                title: 'Proposed task',
                plannedStart: null,
                plannedFinish: null,
                durationWorkingDays: null,
                aiShare: null,
                assignees: [],
              }),
            },
          ],
          newRedFlags: [],
        },
      },
    }).requests
    renderKanban()
    await screen.findByRole('group', { name: 'Kanban of Apollo' })

    expect(screen.getByRole('list', { name: 'Proposals under review' })).toHaveTextContent(
      'AI proposal under review: 2 changes shown as pending',
    )
    // The live card keeps what the plan has, with the pending change apart on it.
    const guideCard = card('Write guide')
    expect(within(guideCard).getByLabelText('Assigned')).toHaveTextContent('AL')
    expect(
      within(guideCard).getByRole('group', { name: 'Pending change to Write guide' }),
    ).toHaveTextContent('Pending changeAssigned: alice → bob')

    // The task it would create is a card of its own, marked pending, below the live cards.
    const notStarted = column('Not started')
    expect(within(notStarted).getByRole('separator', { name: 'Proposed' })).toBeInTheDocument()
    const proposed = within(
      within(notStarted).getByRole('list', { name: 'Not started, proposed' }),
    ).getByRole('article', { name: 'Proposed task, proposed' })
    expect(proposed).toHaveAttribute('data-pending', 'true')
    expect(within(proposed).getByText('Pending')).toBeInTheDocument()
    expect(within(proposed).queryByRole('button')).toBeNull()
    expect(within(proposed).getByRole('link', { name: /^Review/ })).toHaveAttribute(
      'href',
      `/proposals/${P}`,
    )
    expect(within(notStarted).getByLabelText('2 tasks')).toBeInTheDocument()
    expect(requests.filter((request) => request.method !== 'GET')).toEqual([])
  })
})

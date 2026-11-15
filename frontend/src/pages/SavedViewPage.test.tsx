import { render, screen, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { fakeApi, type FakeAnswer } from '../test/fetch.ts'
import { SavedViewPage } from './SavedViewPage.tsx'

const APOLLO = '00000000-0000-4000-8000-000000000001'
const BOREALIS = '00000000-0000-4000-8000-000000000002'
const ALICE = '00000000-0000-4000-8000-0000000000a1'
const VIEW = '00000000-0000-4000-8000-0000000000e1'

const baseTask = {
  description: '',
  status: 'in-progress',
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

function view(kind: string) {
  return {
    id: VIEW,
    name: 'Team board',
    kind,
    keptIn: 'personal',
    projectId: null,
    groupId: null,
    ownerId: ALICE,
    projects: [APOLLO, BOREALIS],
    filter: [
      { field: 'status', operator: 'is', value: 'in-progress' },
      { field: 'assignees', operator: 'contains', value: { viewer: true } },
    ],
  }
}

function answer(kind: string) {
  return (_method: string, path: string): FakeAnswer => {
    switch (path) {
      case `/api/saved-views/${VIEW}`:
        return { status: 200, body: view(kind) }
      case `/api/saved-views/${VIEW}/tasks`:
        return {
          status: 200,
          body: [
            { ...baseTask, id: 'a', projectId: APOLLO, title: 'A-doing' },
            { ...baseTask, id: 'b', projectId: BOREALIS, title: 'B-doing' },
          ],
        }
      case '/api/groups':
      case '/api/repositories':
      case `/api/projects/${APOLLO}/red-flags`:
      case `/api/projects/${BOREALIS}/red-flags`:
      case `/api/projects/${BOREALIS}/members`:
        return { status: 200, body: [] }
      case `/api/projects/${APOLLO}`:
        return { status: 200, body: { id: APOLLO, name: 'Apollo' } }
      case `/api/projects/${BOREALIS}`:
        return { status: 200, body: { id: BOREALIS, name: 'Borealis' } }
      case `/api/projects/${APOLLO}/members`:
        return { status: 200, body: [{ accountId: ALICE, username: 'alice', role: 'admin' }] }
      case '/api/calendar':
        return { status: 200, body: { weekendDays: ['saturday', 'sunday'], holidays: [] } }
      case '/api/tasks/a/relations':
        return { status: 200, body: { taskId: 'a', parent: null, blockedBy: [] } }
      case '/api/tasks/b/relations':
        return { status: 200, body: { taskId: 'b', parent: null, blockedBy: [] } }
      default:
        return {
          status: 403,
          body: {
            statusCode: 403,
            error: 'Not Visible',
            message: 'This view is not visible to you',
          },
        }
    }
  }
}

function renderView(id = VIEW) {
  render(
    <MemoryRouter initialEntries={[`/views/${id}`]}>
      <Routes>
        <Route path="/views/:viewId" element={<SavedViewPage />} />
      </Routes>
    </MemoryRouter>,
  )
}

afterEach(() => vi.unstubAllGlobals())

describe('an opened saved view', () => {
  it('lays a Kanban view out over the projects it covers, with its filter in words', async () => {
    const requests = fakeApi(answer('kanban'))
    renderView()
    const kanban = await screen.findByRole('group', { name: 'Team board' })
    const inProgress = within(kanban).getByRole('region', { name: 'In progress', exact: true })
    expect(within(inProgress).getByRole('article', { name: 'A-doing' })).toBeInTheDocument()
    expect(within(inProgress).getByRole('article', { name: 'B-doing' })).toBeInTheDocument()
    const about = screen.getByRole('list', { name: 'Filter' })
    expect(
      within(about)
        .getAllByRole('listitem')
        .map((item) => item.textContent),
    ).toEqual(['Status is In progress', 'Assigned people contains the person viewing'])
    expect(screen.getByText('Apollo, Borealis')).toBeInTheDocument()
    // Opening it changes nothing.
    expect(requests.every((request) => request.method === 'GET')).toBe(true)
  })

  it('draws a Gantt view as a Gantt', async () => {
    fakeApi(answer('gantt'))
    renderView()
    expect(await screen.findByRole('table', { name: 'Team board' })).toBeInTheDocument()
  })

  it('says so of a view that is not visible', async () => {
    fakeApi(answer('kanban'))
    renderView('00000000-0000-4000-8000-0000000000e9')
    expect(await screen.findByRole('alert')).toHaveTextContent('This view is not visible to you')
  })
})

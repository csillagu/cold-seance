import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Outlet, Route, Routes } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { fakeApi, type FakeAnswer } from '../test/fetch.ts'
import { NewTaskPage } from './NewTaskPage.tsx'
import type { ProjectContext } from './project-context.ts'

const APOLLO = '00000000-0000-4000-8000-000000000001'
const T = '00000000-0000-4000-8000-00000000000a'
const TC_REPO = '00000000-0000-4000-8000-0000000000e1'

/** A fake API: Apollo pulls from `repositories`, and creating or assigning answers as given. */
function serve({
  repositories = [],
  create = { status: 201, body: { id: T } },
  assign = { status: 200, body: { id: T } },
}: { repositories?: unknown[]; create?: FakeAnswer; assign?: FakeAnswer } = {}) {
  return fakeApi((method, path) => {
    if (method === 'GET' && path === `/api/projects/${APOLLO}/repositories`) {
      return { status: 200, body: repositories }
    }
    if (method === 'POST' && path === `/api/projects/${APOLLO}/tasks`) return create
    if (method === 'PUT' && path === `/api/tasks/${T}/repository`) return assign
    return { status: 404, body: { statusCode: 404, error: 'Not Found', message: 'Not found' } }
  })
}

function renderPage() {
  const context: ProjectContext = { id: APOLLO, name: 'Apollo' }
  return render(
    <MemoryRouter initialEntries={[`/projects/${APOLLO}/tasks/new`]}>
      <Routes>
        <Route path="/projects/:projectId" element={<Outlet context={context} />}>
          <Route path="tasks/new" element={<NewTaskPage />} />
        </Route>
        <Route path="/tasks/:taskId" element={<p>Task page</p>} />
      </Routes>
    </MemoryRouter>,
  )
}

afterEach(() => vi.unstubAllGlobals())

const form = () => screen.getByRole('form', { name: 'New task' })
const type = (label: string, value: string) =>
  fireEvent.change(within(form()).getByLabelText(label), { target: { value } })

describe('creating a task with the task details editor (SC-098)', () => {
  it('creates a task with every field typed, then opens it (TC-001)', async () => {
    const requests = serve()
    renderPage()
    type('Title', 'Write install guide')
    type('Description', 'Steps for a fresh install')
    type('Planned start', '2027-03-01')
    type('Duration in working days', '3')
    type('Effort', '5')
    type('AI share in percent', '0')
    fireEvent.click(screen.getByRole('button', { name: 'Create task' }))
    expect(await screen.findByText('Task page')).toBeInTheDocument()
    expect(requests.filter((r) => r.method === 'POST').map((r) => r.body)).toEqual([
      {
        title: 'Write install guide',
        description: 'Steps for a fresh install',
        plannedStart: '2027-03-01',
        durationWorkingDays: 3,
        effort: 5,
        aiShare: 0,
      },
    ])
  })

  it('creates a task with a title only, unscheduled (TC-003)', async () => {
    const requests = serve()
    renderPage()
    expect(within(form()).getByText(/No planned dates/)).toBeInTheDocument()
    type('Title', 'Triage backlog')
    fireEvent.click(screen.getByRole('button', { name: 'Create task' }))
    expect(await screen.findByText('Task page')).toBeInTheDocument()
    expect(requests.filter((r) => r.method === 'POST').map((r) => r.body)).toEqual([
      { title: 'Triage backlog' },
    ])
  })

  it('creates a milestone fixed to its planned start for a duration of 0 (TC-286)', async () => {
    const requests = serve()
    renderPage()
    type('Title', 'Launch')
    type('Effort', '5')
    type('Planned start', '2027-03-12')
    type('Duration in working days', '0')
    expect(within(form()).getByText(/a milestone fixed to the planned start/)).toBeInTheDocument()
    expect(within(form()).queryByLabelText('Effort')).not.toBeInTheDocument()
    expect(within(form()).queryByLabelText('AI share in percent')).not.toBeInTheDocument()
    expect(within(form()).queryByLabelText('Planned finish')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Create task' }))
    expect(await screen.findByText('Task page')).toBeInTheDocument()
    expect(requests.filter((r) => r.method === 'POST').map((r) => r.body)).toEqual([
      { title: 'Launch', milestone: { variant: 'fixed-date', date: '2027-03-12' } },
    ])
  })

  it('creates a floating milestone for a duration of 0 and no date (TC-286)', async () => {
    const requests = serve()
    renderPage()
    type('Title', 'Docs ready')
    type('Duration in working days', '0')
    expect(within(form()).getByText(/a floating milestone/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Create task' }))
    expect(await screen.findByText('Task page')).toBeInTheDocument()
    expect(requests.filter((r) => r.method === 'POST').map((r) => r.body)).toEqual([
      { title: 'Docs ready', milestone: { variant: 'floating' } },
    ])
  })

  it('offers 1% once the AI share is 100%, and not before (TC-221)', () => {
    serve()
    renderPage()
    expect(within(form()).queryByLabelText('Person load in percent')).not.toBeInTheDocument()
    type('AI share in percent', '100')
    expect(within(form()).getByLabelText('Person load in percent')).toHaveValue(1)
  })

  it('refuses a duration that is not whole working days, sending nothing (TC-002)', () => {
    const requests = serve()
    renderPage()
    type('Title', 'Draft schema')
    type('Duration in working days', '2.5')
    fireEvent.click(screen.getByRole('button', { name: 'Create task' }))
    expect(within(form()).getByRole('alert')).toHaveTextContent(
      'The duration is a whole number of working days: 0 for a milestone, or 1 or more.',
    )
    expect(requests.filter((r) => r.method === 'POST')).toHaveLength(0)
  })

  it('assigns the new task to the repository chosen (TC-208)', async () => {
    const requests = serve({
      repositories: [{ id: TC_REPO, githubId: 1, owner: 'csillagu', name: 'tc-repo' }],
    })
    renderPage()
    const choice = await within(form()).findByRole('combobox', { name: 'Repository' })
    type('Title', 'T')
    fireEvent.change(choice, { target: { value: TC_REPO } })
    fireEvent.click(screen.getByRole('button', { name: 'Create task' }))
    expect(await screen.findByText('Task page')).toBeInTheDocument()
    expect(requests.filter((r) => r.method === 'PUT').map((r) => r.body)).toEqual([
      { repositoryId: TC_REPO },
    ])
  })

  it('says the project pulls from no repository', async () => {
    serve()
    renderPage()
    expect(
      await within(form()).findByText('The project pulls issues from no repository.'),
    ).toBeInTheDocument()
  })

  it("shows the API's refusal to create it", async () => {
    serve({
      create: {
        status: 403,
        body: { statusCode: 403, error: 'Forbidden', message: 'Read-only members cannot' },
      },
    })
    renderPage()
    type('Title', 'T')
    fireEvent.click(screen.getByRole('button', { name: 'Create task' }))
    expect(await within(form()).findByRole('alert')).toHaveTextContent('Read-only members cannot')
  })

  it('says the task was created when its repository was refused, and leads to it', async () => {
    serve({
      repositories: [{ id: TC_REPO, githubId: 1, owner: 'csillagu', name: 'tc-repo' }],
      assign: { status: 400, body: { statusCode: 400, error: 'Bad Request', message: 'No' } },
    })
    renderPage()
    const choice = await within(form()).findByRole('combobox', { name: 'Repository' })
    type('Title', 'T')
    fireEvent.change(choice, { target: { value: TC_REPO } })
    fireEvent.click(screen.getByRole('button', { name: 'Create task' }))
    expect(await within(form()).findByRole('alert')).toHaveTextContent(
      'The task was created, but not assigned to the repository: No',
    )
    fireEvent.click(screen.getByRole('link', { name: 'Open the task' }))
    await waitFor(() => expect(screen.getByText('Task page')).toBeInTheDocument())
  })
})

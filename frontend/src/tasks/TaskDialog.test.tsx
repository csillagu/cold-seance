import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { KanbanTask } from '../kanban/kanban-model.ts'
import type { Role } from '../pages/roles.ts'
import { SignedInContext } from '../signed-in.ts'
import { type FakeAnswer, fakeApi, type FakeRequest } from '../test/fetch.ts'
import { TaskDialog } from './TaskDialog.tsx'

const APOLLO = '00000000-0000-4000-8000-000000000001'
const ALICE = '00000000-0000-4000-8000-0000000000a1'
const BOB = '00000000-0000-4000-8000-0000000000b1'

const A: KanbanTask = {
  id: 'a',
  projectId: APOLLO,
  title: 'A',
  status: 'in-progress',
  plannedStart: '2027-03-01',
  plannedFinish: '2027-03-01',
  durationWorkingDays: 1,
  aiShare: null,
  milestone: null,
  assignees: [],
  actualFinish: null,
}
const B: KanbanTask = { ...A, id: 'b', title: 'B', status: 'not-started', assignees: [ALICE] }
const C: KanbanTask = { ...A, id: 'c', title: 'C', status: 'not-started' }

const notFound: FakeAnswer = {
  status: 404,
  body: { statusCode: 404, error: 'Not Found', message: 'Not found' },
}

interface Setup {
  role?: Role
  blockedBy?: string[]
  parent?: string | null
  /** Answers to changes, by method and path; any other change is saved. */
  refusals?: Record<string, FakeAnswer>
}

/** The API of a project Apollo with tasks A, B and C, read by alice as `role`. */
function fakeServer({
  role = 'read-write',
  blockedBy = ['a'],
  parent = null,
  refusals = {},
}: Setup): FakeRequest[] {
  return fakeApi((method, path) => {
    if (method !== 'GET') return refusals[`${method} ${path}`] ?? { status: 200, body: B }
    switch (path) {
      case '/api/tasks/b':
        return { status: 200, body: B }
      case '/api/tasks/b/relations':
        return {
          status: 200,
          body: {
            taskId: 'b',
            parent: parent === null ? null : { id: parent, projectId: APOLLO },
            subtasks: [],
            blockedBy: blockedBy.map((id) => ({ id, projectId: APOLLO })),
          },
        }
      case `/api/projects/${APOLLO}`:
        return { status: 200, body: { id: APOLLO, name: 'Apollo', role } }
      case `/api/projects/${APOLLO}/tasks`:
        return { status: 200, body: [A, B, C] }
      case `/api/projects/${APOLLO}/members`:
        return {
          status: 200,
          body: [
            { accountId: ALICE, username: 'alice', role },
            { accountId: BOB, username: 'bob', role: 'admin' },
          ],
        }
      default:
        return notFound
    }
  })
}

/** Opens B's dialog as alice, and waits for it to read the task. */
async function open(setup: Setup = {}) {
  const requests = fakeServer(setup)
  const onClose = vi.fn<() => void>()
  const onChanged = vi.fn<() => void>()
  render(
    <SignedInContext value={{ id: ALICE, username: 'alice', systemAdmin: false }}>
      <MemoryRouter>
        <Routes>
          <Route
            path="*"
            element={<TaskDialog taskId="b" onClose={onClose} onChanged={onChanged} />}
          />
        </Routes>
      </MemoryRouter>
    </SignedInContext>,
  )
  const dialog = screen.getByRole('dialog')
  await within(dialog).findByRole('heading', { name: 'B' })
  return { requests, dialog, onClose, onChanged }
}

const changes = (requests: FakeRequest[]) => requests.filter((request) => request.method !== 'GET')

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('the task dialog, for the read-write and admin roles (#209, SC-067)', () => {
  it('changes its fields, and closes once they are saved', async () => {
    const { requests, dialog, onClose, onChanged } = await open()
    fireEvent.change(within(dialog).getByLabelText('Title'), { target: { value: 'B2' } })
    fireEvent.change(within(dialog).getByLabelText('Planned start'), {
      target: { value: '2027-03-03' },
    })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(onClose).toHaveBeenCalled())
    expect(onChanged).toHaveBeenCalled()
    expect(changes(requests)).toEqual([
      { method: 'PATCH', path: '/api/tasks/b', body: { title: 'B2', plannedStart: '2027-03-03' } },
    ])
  })

  it('changes its status among those it can move to', async () => {
    const { requests, dialog } = await open({ role: 'admin' })
    const status = within(dialog).getByLabelText('Status')
    expect(
      within(status)
        .getAllByRole('option')
        .map((option) => option.textContent),
    ).toEqual(['Not started', 'In progress', 'On hold', 'Done', 'Cancelled'])
    fireEvent.change(status, { target: { value: 'cancelled' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Change status' }))
    await waitFor(() =>
      expect(changes(requests)).toEqual([
        { method: 'POST', path: '/api/tasks/b/cancel', body: {} },
      ]),
    )
  })

  it('removes and adds the tasks it is blocked by', async () => {
    const { requests, dialog } = await open()
    const blockers = within(dialog).getByRole('list', { name: 'Blocked by' })
    expect(within(blockers).getByText('A')).toBeInTheDocument()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Remove the blocker A' }))
    await waitFor(() =>
      expect(changes(requests)).toContainEqual({
        method: 'DELETE',
        path: '/api/tasks/b/blocked-by/a',
        body: undefined,
      }),
    )

    const add = within(dialog).getByLabelText('Add a blocker')
    // Neither the task itself nor a task it is already blocked by is offered.
    expect(
      within(add)
        .getAllByRole('option')
        .map((option) => option.textContent),
    ).toEqual(['Choose a task', 'C'])
    fireEvent.change(add, { target: { value: 'c' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Add' }))
    await waitFor(() =>
      expect(changes(requests)).toContainEqual({
        method: 'POST',
        path: '/api/tasks/b/blocked-by',
        body: { blockerId: 'c' },
      }),
    )
  })

  it('names a blocker of another project as such', async () => {
    const { dialog } = await open({ blockedBy: ['m-elsewhere'] })
    expect(within(dialog).getByText('A milestone of another project')).toBeInTheDocument()
  })

  it('sets its parent, and makes it a subtask of none', async () => {
    const { requests, dialog } = await open({ blockedBy: [], parent: 'c' })
    const parent = within(dialog).getByLabelText('Subtask of')
    expect(parent).toHaveValue('c')
    fireEvent.change(parent, { target: { value: '' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Set parent' }))
    await waitFor(() =>
      expect(changes(requests)).toEqual([
        { method: 'PUT', path: '/api/tasks/b/parent', body: { parentId: null } },
      ]),
    )
  })

  it("shows the API's refusal and stays open (FR-060)", async () => {
    const { dialog, onClose, onChanged } = await open({
      refusals: {
        'PATCH /api/tasks/b': {
          status: 403,
          body: { statusCode: 403, error: 'Forbidden', message: 'Your role does not allow this' },
        },
      },
    })
    fireEvent.change(within(dialog).getByLabelText('Title'), { target: { value: 'B2' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }))
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      'Your role does not allow this',
    )
    expect(onClose).not.toHaveBeenCalled()
    expect(onChanged).not.toHaveBeenCalled()
  })

  it('leads to the full task page', async () => {
    const { dialog } = await open()
    expect(within(dialog).getByRole('link', { name: "Open the task's page" })).toHaveAttribute(
      'href',
      '/tasks/b',
    )
  })
})

describe('the task dialog, for a contributor (#209, FR-107)', () => {
  it('shows everything, and offers only in progress, on hold and done on a task of theirs', async () => {
    const { requests, dialog } = await open({ role: 'contributor', parent: 'c' })
    const status = within(dialog).getByLabelText('Status')
    expect(
      within(status)
        .getAllByRole('option')
        .map((option) => option.textContent),
    ).toEqual(['Not started', 'In progress', 'On hold', 'Done'])
    const details = within(dialog).getByLabelText('Details')
    expect(details).toHaveTextContent('Planned start1 Mar 2027')
    expect(details).toHaveTextContent('Assignedalice')
    expect(within(dialog).getByRole('list', { name: 'Blocked by' })).toHaveTextContent('A')
    expect(within(dialog).getByRole('region', { name: 'Parent' })).toHaveTextContent('C')
    expect(within(dialog).queryByRole('textbox')).toBeNull()
    expect(within(dialog).queryByRole('button', { name: /Remove|Add|Set parent|Save/ })).toBeNull()

    fireEvent.change(status, { target: { value: 'done' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Change status' }))
    await waitFor(() =>
      expect(changes(requests)).toEqual([
        { method: 'PUT', path: '/api/tasks/b/status', body: { status: 'done' } },
      ]),
    )
  })

  it('offers no control at all on a task they are not assigned to', async () => {
    const requests = fakeServer({ role: 'contributor' })
    render(
      <SignedInContext value={{ id: BOB, username: 'bob', systemAdmin: false }}>
        <MemoryRouter>
          <TaskDialog taskId="b" onClose={() => {}} />
        </MemoryRouter>
      </SignedInContext>,
    )
    const dialog = screen.getByRole('dialog')
    await within(dialog).findByRole('heading', { name: 'B' })
    expect(within(dialog).getByText('Not started')).toBeInTheDocument()
    expect(within(dialog).queryByRole('combobox')).toBeNull()
    expect(
      within(dialog)
        .getAllByRole('button')
        .map((button) => button.textContent),
    ).toEqual(['Close'])
    expect(changes(requests)).toEqual([])
  })
})

describe('the task dialog, for the read-only role (#209, FR-106)', () => {
  it('shows everything and offers no control, even on a task they are assigned to', async () => {
    const { dialog } = await open({ role: 'read-only' })
    expect(within(dialog).getByText('Not started')).toBeInTheDocument()
    expect(within(dialog).getByLabelText('Details')).toHaveTextContent('Assignedalice')
    expect(within(dialog).getByRole('list', { name: 'Blocked by' })).toHaveTextContent('A')
    expect(within(dialog).getByRole('region', { name: 'Parent' })).toHaveTextContent('None')
    expect(within(dialog).queryByRole('combobox')).toBeNull()
    expect(within(dialog).queryByRole('textbox')).toBeNull()
    expect(
      within(dialog)
        .getAllByRole('button')
        .map((button) => button.textContent),
    ).toEqual(['Close'])
  })
})

describe('the task dialog, opening', () => {
  it('closes with Escape and with Close', async () => {
    const { dialog, onClose } = await open()
    fireEvent.keyDown(dialog, { key: 'Escape' })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Close' }))
    expect(onClose).toHaveBeenCalledTimes(2)
  })

  it('closes with Escape wherever the focus is', async () => {
    const { onClose } = await open()
    fireEvent.keyDown(document.body, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('closes on a click outside it, but not on one inside it or a drag out of it', async () => {
    const { dialog, onClose } = await open()
    const backdrop = dialog.parentElement
    if (backdrop === null) throw new Error('The dialog has no backdrop')
    fireEvent.mouseDown(dialog)
    fireEvent.mouseUp(dialog)
    fireEvent.click(dialog)
    fireEvent.mouseDown(within(dialog).getByText('Blocked by'))
    fireEvent.mouseUp(backdrop)
    fireEvent.click(backdrop)
    expect(onClose).not.toHaveBeenCalled()
    fireEvent.mouseDown(backdrop)
    fireEvent.mouseUp(backdrop)
    fireEvent.click(backdrop)
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('says so when the task is not visible to the viewer', async () => {
    fakeApi(() => ({
      status: 403,
      body: {
        statusCode: 403,
        error: 'Not Visible',
        message: 'This project is not visible to you',
      },
    }))
    render(
      <MemoryRouter>
        <TaskDialog taskId="b" onClose={() => {}} />
      </MemoryRouter>,
    )
    expect(await screen.findByRole('alert')).toHaveTextContent('This project is not visible to you')
  })
})

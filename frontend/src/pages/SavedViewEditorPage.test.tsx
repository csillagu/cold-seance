import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { fakeApi, type FakeAnswer } from '../test/fetch.ts'
import { SavedViewEditorPage } from './SavedViewEditorPage.tsx'

const APOLLO = '00000000-0000-4000-8000-000000000001'
const BOREALIS = '00000000-0000-4000-8000-000000000002'
const PLATFORM = '00000000-0000-4000-8000-0000000000f1'
const ALICE = '00000000-0000-4000-8000-0000000000a1'
const BOB = '00000000-0000-4000-8000-0000000000b1'
const VIEW = '00000000-0000-4000-8000-0000000000e1'

const refused: FakeAnswer = {
  status: 403,
  body: { statusCode: 403, error: 'Forbidden', message: 'You cannot save views in this group' },
}

function answer(saving: FakeAnswer) {
  return (method: string, path: string): FakeAnswer => {
    if (method === 'POST' && path === '/api/saved-views') return saving
    switch (path) {
      case '/api/projects':
        return {
          status: 200,
          body: [
            { id: APOLLO, name: 'Apollo' },
            { id: BOREALIS, name: 'Borealis' },
          ],
        }
      case '/api/groups':
        return { status: 200, body: [{ id: PLATFORM, name: 'Platform' }] }
      case `/api/groups/${PLATFORM}/projects`:
        return { status: 200, body: [{ id: APOLLO, name: 'Apollo' }] }
      case '/api/repositories':
        return { status: 200, body: [] }
      case `/api/projects/${APOLLO}/members`:
        return { status: 200, body: [{ accountId: ALICE, username: 'alice', role: 'admin' }] }
      case `/api/projects/${BOREALIS}/members`:
        return { status: 200, body: [{ accountId: BOB, username: 'bob', role: 'admin' }] }
      default:
        return { status: 404, body: { statusCode: 404, error: 'Not Found', message: path } }
    }
  }
}

function renderEditor(at = '/views/new') {
  render(
    <MemoryRouter initialEntries={[at]}>
      <Routes>
        <Route path="/views/new" element={<SavedViewEditorPage />} />
        <Route path="/views/:viewId" element={<p>Opened the view</p>} />
      </Routes>
    </MemoryRouter>,
  )
}

afterEach(() => vi.unstubAllGlobals())

describe('the saved view editor (SC-091, SC-092)', () => {
  it('offers only the Kanban and Gantt kinds (FR-054)', async () => {
    fakeApi(answer({ status: 201, body: { id: VIEW } }))
    renderEditor()
    const kind = await screen.findByLabelText('Kind')
    expect(
      within(kind)
        .getAllByRole('option')
        .map((option) => option.textContent),
    ).toEqual(['Kanban', 'Gantt'])
  })

  it('saves a personal view over the chosen projects with its filter, and opens it', async () => {
    const requests = fakeApi(answer({ status: 201, body: { id: VIEW } }))
    renderEditor()
    fireEvent.change(await screen.findByLabelText('Name'), { target: { value: 'Team board' } })
    fireEvent.click(screen.getByRole('checkbox', { name: 'Apollo' }))
    fireEvent.click(screen.getByRole('checkbox', { name: 'Borealis' }))
    fireEvent.click(screen.getByRole('button', { name: 'Add condition' }))
    const first = screen.getByRole('group', { name: 'Condition 1' })
    fireEvent.change(within(first).getByLabelText('Field'), { target: { value: 'status' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add condition' }))
    const second = screen.getByRole('group', { name: 'Condition 2' })
    fireEvent.change(within(second).getByLabelText('Field'), { target: { value: 'assignees' } })
    // The people are the members of the covered projects, besides the person viewing.
    await waitFor(() =>
      expect(within(second).getByRole('option', { name: 'bob' })).toBeInTheDocument(),
    )
    expect(within(second).getByRole('option', { name: 'The person viewing' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Save view' }))

    expect(await screen.findByText('Opened the view')).toBeInTheDocument()
    expect(requests.find((request) => request.method === 'POST')?.body).toEqual({
      name: 'Team board',
      kind: 'kanban',
      keptIn: 'personal',
      projects: [APOLLO, BOREALIS],
      filter: [
        { field: 'status', operator: 'is', value: 'in-progress' },
        { field: 'assignees', operator: 'contains', value: { viewer: true } },
      ],
    })
  })

  it('starts with the view kept in the project the address names', async () => {
    const requests = fakeApi(answer({ status: 201, body: { id: VIEW } }))
    renderEditor(`/views/new?project=${APOLLO}`)
    fireEvent.change(await screen.findByLabelText('Name'), { target: { value: 'Apollo board' } })
    expect(screen.getByRole('radio', { name: 'In a project' })).toBeChecked()
    expect(screen.getByLabelText('Project')).toHaveValue(APOLLO)
    fireEvent.change(screen.getByLabelText('Kind'), { target: { value: 'gantt' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save view' }))

    expect(await screen.findByText('Opened the view')).toBeInTheDocument()
    expect(requests.find((request) => request.method === 'POST')?.body).toEqual({
      name: 'Apollo board',
      kind: 'gantt',
      keptIn: 'project',
      projectId: APOLLO,
      projects: [APOLLO],
      filter: [],
    })
  })

  it("covers some of a group's projects, and shows a refusal in the API's words", async () => {
    const requests = fakeApi(answer(refused))
    renderEditor()
    fireEvent.change(await screen.findByLabelText('Name'), { target: { value: 'Group board' } })
    fireEvent.click(screen.getByRole('radio', { name: 'In a group' }))
    fireEvent.change(screen.getByLabelText('Group'), { target: { value: PLATFORM } })
    fireEvent.click(await screen.findByRole('checkbox', { name: 'Apollo' }))
    expect(screen.queryByRole('checkbox', { name: 'Borealis' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Save view' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'You cannot save views in this group',
    )
    expect(requests.find((request) => request.method === 'POST')?.body).toMatchObject({
      keptIn: 'group',
      groupId: PLATFORM,
      projects: [APOLLO],
    })
  })

  it('names a condition that lacks its value, and sends nothing', async () => {
    const requests = fakeApi(answer({ status: 201, body: { id: VIEW } }))
    renderEditor()
    fireEvent.change(await screen.findByLabelText('Name'), { target: { value: 'Mine' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add condition' }))
    fireEvent.click(screen.getByRole('button', { name: 'Save view' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Title needs a text to compare with')
    expect(requests.some((request) => request.method === 'POST')).toBe(false)
  })
})

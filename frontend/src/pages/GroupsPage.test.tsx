import { fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SignedInContext } from '../signed-in.ts'
import { type FakeAnswer, fakeApi } from '../test/fetch.ts'
import { GroupsPage } from './GroupsPage.tsx'

const PLATFORM = { id: '00000000-0000-4000-8000-0000000000c1', name: 'Platform' }
const ERINS = { id: '00000000-0000-4000-8000-0000000000c2', name: "Erin's group" }
const ERIN = '00000000-0000-4000-8000-0000000000e1'

/** The groups API, its groups held as the server would hold them. */
function fakeGroups(refusals: Record<string, FakeAnswer> = {}) {
  let groups = [PLATFORM]
  return fakeApi((method, path) => {
    const refusal = refusals[`${method} ${path}`]
    if (refusal) return refusal
    if (method === 'GET' && path === '/api/groups') return { status: 200, body: groups }
    if (method === 'POST' && path === '/api/groups') {
      groups = [ERINS, PLATFORM]
      return { status: 201, body: ERINS }
    }
    if (method === 'DELETE' && path === `/api/groups/${PLATFORM.id}`) {
      groups = []
      return { status: 204 }
    }
    return { status: 404, body: { statusCode: 404, error: 'Not Found', message: 'No such route' } }
  })
}

function renderGroups(systemAdmin = false) {
  render(
    <SignedInContext value={{ id: ERIN, username: 'erin', systemAdmin }}>
      <MemoryRouter initialEntries={['/groups']}>
        <Routes>
          <Route path="groups" element={<GroupsPage />} />
        </Routes>
      </MemoryRouter>
    </SignedInContext>,
  )
}

const names = (table: HTMLElement) =>
  within(table)
    .getAllByRole('rowheader')
    .map((cell) => cell.textContent)

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('the group list screen (SC-082)', () => {
  it('lists every group, each leading to its members and projects', async () => {
    fakeGroups()
    renderGroups()
    const table = await screen.findByRole('table', { name: 'Groups' })
    expect(names(table)).toEqual(['Platform'])
    expect(within(table).getByRole('link', { name: 'Projects' })).toHaveAttribute(
      'href',
      `/groups/${PLATFORM.id}/projects`,
    )
    expect(within(table).getByRole('link', { name: 'Members' })).toHaveAttribute(
      'href',
      `/groups/${PLATFORM.id}/members`,
    )
  })

  it('creates a group and lists it', async () => {
    const requests = fakeGroups()
    renderGroups()
    await screen.findByRole('table', { name: 'Groups' })
    fireEvent.change(screen.getByLabelText('Group name'), { target: { value: "Erin's group" } })
    fireEvent.click(screen.getByRole('button', { name: 'Create group' }))
    expect(await screen.findByRole('status')).toHaveTextContent(
      "Group Erin's group is created, and you are its admin.",
    )
    expect(names(screen.getByRole('table', { name: 'Groups' }))).toEqual([
      "Erin's group",
      'Platform',
    ])
    expect(requests).toContainEqual({
      method: 'POST',
      path: '/api/groups',
      body: { name: "Erin's group" },
    })
  })

  it("shows a refused creation in the API's words", async () => {
    fakeGroups({
      'POST /api/groups': {
        status: 409,
        body: {
          statusCode: 409,
          error: 'Conflict',
          message: 'A group named Platform already exists',
        },
      },
    })
    renderGroups()
    await screen.findByRole('table', { name: 'Groups' })
    fireEvent.change(screen.getByLabelText('Group name'), { target: { value: 'Platform' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create group' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'A group named Platform already exists',
    )
  })

  it('offers no delete action to someone who is not a system admin', async () => {
    fakeGroups()
    renderGroups(false)
    await screen.findByRole('table', { name: 'Groups' })
    expect(screen.queryByRole('button', { name: /Delete/ })).toBeNull()
  })

  it('lets a system admin delete a group once they confirm it', async () => {
    const requests = fakeGroups()
    renderGroups(true)
    await screen.findByRole('table', { name: 'Groups' })
    fireEvent.click(screen.getByRole('button', { name: 'Delete Platform' }))
    expect(requests.filter((r) => r.method === 'DELETE')).toEqual([])
    fireEvent.click(screen.getByRole('button', { name: 'Keep it' }))
    fireEvent.click(screen.getByRole('button', { name: 'Delete Platform' }))
    fireEvent.click(screen.getByRole('button', { name: 'Delete Platform for good' }))
    expect(await screen.findByRole('status')).toHaveTextContent(
      'Group Platform is deleted. Its projects stay.',
    )
    expect(await screen.findByText('No groups yet.')).toBeInTheDocument()
    expect(requests.filter((r) => r.method === 'DELETE')).toEqual([
      { method: 'DELETE', path: `/api/groups/${PLATFORM.id}`, body: undefined },
    ])
  })
})

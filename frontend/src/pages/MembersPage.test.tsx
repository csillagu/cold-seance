import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ProjectsChangedContext } from '../projects-changed.ts'
import { SignedInContext } from '../signed-in.ts'
import { type FakeAnswer, fakeApi } from '../test/fetch.ts'
import { MembersPage } from './MembersPage.tsx'
import { ProjectPage } from './ProjectPage.tsx'

const APOLLO = '00000000-0000-4000-8000-000000000001'
const ALICE = '00000000-0000-4000-8000-0000000000a1'
const BOB = '00000000-0000-4000-8000-0000000000b1'
const MEMBERS = `/api/projects/${APOLLO}/members`

const alice = { accountId: ALICE, username: 'alice', role: 'admin' }
const bob = { accountId: BOB, username: 'bob', role: 'read-only' }

/**
 * Apollo's API, its members held as the server would hold them, so that the screen's reading
 * them afresh after each change shows the change.
 */
function fakeApollo(refusals: Record<string, FakeAnswer> = {}) {
  let members: (typeof alice)[] = [alice]
  const requests = fakeApi((method, path) => {
    const refusal = refusals[`${method} ${path}`]
    if (refusal) return refusal
    if (path === `/api/projects/${APOLLO}`) {
      return { status: 200, body: { id: APOLLO, name: 'Apollo' } }
    }
    if (method === 'GET' && path === MEMBERS) return { status: 200, body: members }
    if (method === 'POST' && path === MEMBERS) {
      members = [alice, bob]
      return { status: 200, body: bob }
    }
    if (method === 'PUT' && path === `${MEMBERS}/${BOB}`) {
      const changed = { ...bob, role: 'read-write' }
      members = [alice, changed]
      return { status: 200, body: changed }
    }
    if (method === 'DELETE' && path === `${MEMBERS}/${BOB}`) {
      members = [alice]
      return { status: 204 }
    }
    return { status: 404, body: { statusCode: 404, error: 'Not Found', message: 'No such route' } }
  })
  return { requests, setMembers: (next: (typeof alice)[]) => (members = next) }
}

function renderMembers(projectsChanged = () => {}) {
  render(
    <SignedInContext value={{ id: ALICE, username: 'alice', systemAdmin: false }}>
      <ProjectsChangedContext value={projectsChanged}>
        <MemoryRouter initialEntries={[`/projects/${APOLLO}/members`]}>
          <Routes>
            <Route path="projects/:projectId" element={<ProjectPage />}>
              <Route path="members" element={<MembersPage />} />
            </Route>
          </Routes>
        </MemoryRouter>
      </ProjectsChangedContext>
    </SignedInContext>,
  )
}

const usernames = (table: HTMLElement) =>
  within(table)
    .getAllByRole('rowheader')
    .map((cell) => cell.textContent)

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('the project members and roles screen (SC-080)', () => {
  it('shows someone who is not the project’s admin the roles, with no control to change them (#256)', async () => {
    fakeApollo({
      [`GET /api/projects/${APOLLO}`]: {
        status: 200,
        body: { id: APOLLO, name: 'Apollo', role: 'read-only' },
      },
    })
    renderMembers()
    const table = await screen.findByRole('table', { name: 'Members of Apollo' })
    expect(within(table).getByRole('cell', { name: 'Admin' })).toBeInTheDocument()
    expect(within(table).queryByRole('combobox')).toBeNull()
    expect(within(table).queryByRole('button')).toBeNull()
    expect(screen.queryByRole('form', { name: 'Add a member' })).toBeNull()
    expect(screen.queryByRole('link', { name: 'New task' })).toBeNull()
  })

  it("is a tab of the project's page and lists the members with their roles", async () => {
    fakeApollo().setMembers([alice, bob])
    renderMembers()
    const table = await screen.findByRole('table', { name: 'Members of Apollo' })
    expect(screen.getByRole('link', { name: 'Members' })).toHaveAttribute(
      'href',
      `/projects/${APOLLO}/members`,
    )
    expect(usernames(table)).toEqual(['alice(you)', 'bob'])
    expect(screen.getByRole('combobox', { name: 'Role of alice' })).toHaveValue('admin')
    expect(screen.getByRole('combobox', { name: 'Role of bob' })).toHaveValue('read-only')
  })

  it('offers exactly the four roles (FR-105)', async () => {
    fakeApollo()
    renderMembers()
    const select = await screen.findByRole('combobox', { name: 'Role of alice' })
    expect(
      within(select)
        .getAllByRole('option')
        .map((o) => o.textContent),
    ).toEqual(['Read-only', 'Contributor', 'Read-write', 'Admin'])
  })

  it('adds a person by username with a role (FR-109)', async () => {
    const { requests } = fakeApollo()
    renderMembers()
    await screen.findByRole('table', { name: 'Members of Apollo' })
    fireEvent.change(screen.getByLabelText('Username'), { target: { value: 'bob' } })
    fireEvent.change(screen.getByLabelText('Role'), { target: { value: 'read-only' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add member' }))
    expect(await screen.findByRole('status')).toHaveTextContent('bob is now read-only in Apollo.')
    expect(requests).toContainEqual({
      method: 'POST',
      path: MEMBERS,
      body: { username: 'bob', role: 'read-only' },
    })
    await waitFor(() =>
      expect(screen.getByRole('combobox', { name: 'Role of bob' })).toHaveValue('read-only'),
    )
    expect(screen.getByLabelText('Username')).toHaveValue('')
  })

  it("changes a member's role and removes a member (FR-109)", async () => {
    const { requests, setMembers } = fakeApollo()
    setMembers([alice, bob])
    renderMembers()
    fireEvent.change(await screen.findByRole('combobox', { name: 'Role of bob' }), {
      target: { value: 'read-write' },
    })
    expect(await screen.findByRole('status')).toHaveTextContent('bob is now read-write in Apollo.')
    expect(requests).toContainEqual({
      method: 'PUT',
      path: `${MEMBERS}/${BOB}`,
      body: { role: 'read-write' },
    })
    await waitFor(() =>
      expect(screen.getByRole('combobox', { name: 'Role of bob' })).toHaveValue('read-write'),
    )

    fireEvent.click(screen.getByRole('button', { name: 'Remove bob' }))
    expect(await screen.findByRole('status')).toHaveTextContent(
      'bob is no longer a member of Apollo.',
    )
    await waitFor(() =>
      expect(usernames(screen.getByRole('table', { name: 'Members of Apollo' }))).toEqual([
        'alice(you)',
      ]),
    )
  })

  it("shows the API's refusal to remove the last admin, and keeps her listed as admin (FR-110)", async () => {
    const lastAdmin: FakeAnswer = {
      status: 409,
      body: {
        statusCode: 409,
        error: 'Conflict',
        message: "The project's last admin cannot be removed",
      },
    }
    fakeApollo({
      [`DELETE ${MEMBERS}/${ALICE}`]: lastAdmin,
      [`PUT ${MEMBERS}/${ALICE}`]: lastAdmin,
    })
    renderMembers()
    fireEvent.click(await screen.findByRole('button', { name: 'Remove alice' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(
      "The project's last admin cannot be removed",
    )
    fireEvent.change(screen.getByRole('combobox', { name: 'Role of alice' }), {
      target: { value: 'read-only' },
    })
    await waitFor(() => expect(screen.getByRole('button', { name: 'Remove alice' })).toBeEnabled())
    expect(screen.getByRole('combobox', { name: 'Role of alice' })).toHaveValue('admin')
  })

  it('shows a refusal of a username no account has', async () => {
    fakeApollo({
      [`POST ${MEMBERS}`]: {
        status: 404,
        body: { statusCode: 404, error: 'Not Found', message: 'There is no such account' },
      },
    })
    renderMembers()
    await screen.findByRole('table', { name: 'Members of Apollo' })
    fireEvent.change(screen.getByLabelText('Username'), { target: { value: 'nobody' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add member' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('There is no such account')
    expect(screen.getByLabelText('Username')).toHaveValue('nobody')
  })

  it('tells the layout when the signed-in person leaves the project, and not otherwise', async () => {
    const projectsChanged = vi.fn<() => void>()
    const { setMembers } = fakeApollo({ [`DELETE ${MEMBERS}/${ALICE}`]: { status: 204 } })
    setMembers([alice, { ...bob, role: 'admin' }])
    renderMembers(projectsChanged)
    fireEvent.change(await screen.findByRole('combobox', { name: 'Role of bob' }), {
      target: { value: 'read-write' },
    })
    await screen.findByRole('status')
    expect(projectsChanged).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Remove alice' }))
    await waitFor(() => expect(projectsChanged).toHaveBeenCalledTimes(1))
  })
})

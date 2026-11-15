import { fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter, Navigate, Route, Routes } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SignedInContext } from '../signed-in.ts'
import { type FakeAnswer, fakeApi } from '../test/fetch.ts'
import { GroupMembersPage } from './GroupMembersPage.tsx'
import { GroupPage } from './GroupPage.tsx'

const PLATFORM = { id: '00000000-0000-4000-8000-0000000000c1', name: 'Platform' }
const ALICE = '00000000-0000-4000-8000-0000000000a1'
const BOB = '00000000-0000-4000-8000-0000000000b1'
const MEMBERS = `/api/groups/${PLATFORM.id}/members`

const alice = { accountId: ALICE, username: 'alice', role: 'admin' }
const bob = { accountId: BOB, username: 'bob', role: 'read-only' }

const forbidden: FakeAnswer = {
  status: 403,
  body: {
    statusCode: 403,
    error: 'Forbidden',
    message: "Only the group's members can see its members",
  },
}

/** Platform's API, its members held as the server would hold them. */
function fakePlatform(refusals: Record<string, FakeAnswer> = {}) {
  let members = [alice]
  const requests = fakeApi((method, path) => {
    const refusal = refusals[`${method} ${path}`]
    if (refusal) return refusal
    if (path === '/api/groups') return { status: 200, body: [PLATFORM] }
    if (method === 'GET' && path === MEMBERS) return { status: 200, body: members }
    if (method === 'POST' && path === MEMBERS) {
      members = [alice, bob]
      return { status: 200, body: bob }
    }
    if (method === 'PUT' && path === `${MEMBERS}/${BOB}`) {
      const changed = { ...bob, role: 'contributor' }
      members = [alice, changed]
      return { status: 200, body: changed }
    }
    if (method === 'DELETE' && path === `${MEMBERS}/${BOB}`) {
      members = [alice]
      return { status: 204 }
    }
    if (method === 'POST' && path === `/api/groups/${PLATFORM.id}/leave`) {
      members = members.filter((m) => m.accountId !== BOB)
      return { status: 204 }
    }
    return { status: 404, body: { statusCode: 404, error: 'Not Found', message: 'No such route' } }
  })
  return { requests, setMembers: (next: (typeof alice)[]) => (members = next) }
}

function renderMembers(as: { id: string; username: string }, at = 'members') {
  render(
    <SignedInContext value={{ ...as, systemAdmin: false }}>
      <MemoryRouter initialEntries={[`/groups/${PLATFORM.id}/${at}`]}>
        <Routes>
          <Route path="groups/:groupId" element={<GroupPage />}>
            <Route index element={<Navigate to="members" replace />} />
            <Route path="members" element={<GroupMembersPage />} />
          </Route>
        </Routes>
      </MemoryRouter>
    </SignedInContext>,
  )
}

const asAlice = { id: ALICE, username: 'alice' }
const asBob = { id: BOB, username: 'bob' }

const usernames = (table: HTMLElement) =>
  within(table)
    .getAllByRole('rowheader')
    .map((cell) => cell.textContent)

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('the group members screen (SC-083)', () => {
  it("is the group page's first screen and lists the members with their roles", async () => {
    fakePlatform().setMembers([alice, bob])
    renderMembers(asAlice, '')
    expect(await screen.findByRole('heading', { level: 1 })).toHaveTextContent('Platform')
    const table = await screen.findByRole('table', { name: 'Members of Platform' })
    expect(usernames(table)).toEqual(['alice(you)', 'bob'])
    expect(screen.getByRole('combobox', { name: 'Role of bob' })).toHaveValue('read-only')
  })

  it('lets an admin add a member by username, change their role and remove them', async () => {
    const { requests } = fakePlatform()
    renderMembers(asAlice)
    await screen.findByRole('table', { name: 'Members of Platform' })

    const form = screen.getByRole('form', { name: 'Add a member' })
    fireEvent.change(within(form).getByLabelText('Username'), { target: { value: 'bob' } })
    fireEvent.change(within(form).getByLabelText('Role'), { target: { value: 'read-only' } })
    fireEvent.click(within(form).getByRole('button', { name: 'Add member' }))
    expect(await screen.findByRole('status')).toHaveTextContent('bob is now read-only in Platform.')

    fireEvent.change(await screen.findByRole('combobox', { name: 'Role of bob' }), {
      target: { value: 'contributor' },
    })
    expect(await screen.findByText('bob is now contributor in Platform.')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Remove bob' }))
    expect(await screen.findByText('bob is no longer a member of Platform.')).toBeInTheDocument()
    expect(usernames(screen.getByRole('table', { name: 'Members of Platform' }))).toEqual([
      'alice(you)',
    ])

    expect(requests.filter((r) => r.method !== 'GET')).toEqual([
      { method: 'POST', path: MEMBERS, body: { username: 'bob', role: 'read-only' } },
      { method: 'PUT', path: `${MEMBERS}/${BOB}`, body: { role: 'contributor' } },
      { method: 'DELETE', path: `${MEMBERS}/${BOB}`, body: undefined },
    ])
  })

  it('shows a member who is not an admin the members without the controls, and lets them leave', async () => {
    const { requests, setMembers } = fakePlatform()
    setMembers([alice, bob])
    renderMembers(asBob)
    await screen.findByRole('table', { name: 'Members of Platform' })
    expect(screen.queryByRole('form', { name: 'Add a member' })).toBeNull()
    expect(screen.queryByRole('combobox')).toBeNull()
    expect(screen.queryByRole('button', { name: /Remove/ })).toBeNull()
    expect(screen.getByLabelText('Role of alice')).toHaveTextContent('Admin')

    fireEvent.click(screen.getByRole('button', { name: 'Leave Platform' }))
    expect(await screen.findByRole('status')).toHaveTextContent('You have left Platform.')
    expect(requests.filter((r) => r.method !== 'GET')).toEqual([
      { method: 'POST', path: `/api/groups/${PLATFORM.id}/leave`, body: undefined },
    ])
  })

  it("shows the last admin's refused leave in the API's words", async () => {
    fakePlatform({
      [`POST /api/groups/${PLATFORM.id}/leave`]: {
        status: 409,
        body: {
          statusCode: 409,
          error: 'Conflict',
          message: "The group's last admin cannot leave it",
        },
      },
    })
    renderMembers(asAlice)
    await screen.findByRole('table', { name: 'Members of Platform' })
    fireEvent.click(screen.getByRole('button', { name: 'Leave Platform' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(
      "The group's last admin cannot leave it",
    )
    expect(usernames(screen.getByRole('table', { name: 'Members of Platform' }))).toEqual([
      'alice(you)',
    ])
  })

  it("tells someone who is not a member, in the API's words, that they cannot see the members", async () => {
    fakePlatform({ [`GET ${MEMBERS}`]: forbidden })
    renderMembers(asBob)
    expect(await screen.findByRole('alert')).toHaveTextContent(
      "Only the group's members can see its members",
    )
    expect(screen.queryByRole('button', { name: /Leave/ })).toBeNull()
  })

  it('says so of a group that does not exist', async () => {
    fakeApi(() => ({ status: 200, body: [] }))
    renderMembers(asAlice)
    expect(await screen.findByRole('heading', { level: 1 })).toHaveTextContent(
      'There is no such group',
    )
  })
})

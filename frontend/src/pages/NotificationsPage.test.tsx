import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ApiNotification } from '../notifications/notification.ts'
import type { Subscriptions } from '../notifications/subscriptions.ts'
import { SignedInContext } from '../signed-in.ts'
import { type FakeAnswer, fakeApi, UNAUTHENTICATED } from '../test/fetch.ts'
import { NotificationsPage } from './NotificationsPage.tsx'

const APOLLO = '00000000-0000-4000-8000-0000000000a0'
const ALICE = '00000000-0000-4000-8000-0000000000a1'
const T = '00000000-0000-4000-8000-000000000011'
const REPO = '00000000-0000-4000-8000-000000000021'

const overload: ApiNotification = {
  id: 'n1',
  kind: 'red-flag',
  createdAt: '2026-11-14T10:00:00.000Z',
  detail: { flagKind: 'overload', projectIds: [APOLLO], accountId: ALICE, date: '2027-03-01' },
}

const waiting: ApiNotification = {
  id: 'n2',
  kind: 'proposal-waiting',
  createdAt: '2026-11-14T09:00:00.000Z',
  detail: { proposalId: 'p1', projectIds: [APOLLO] },
}

/** The page's API: alice's notifications and subscriptions, held as the server would. */
function fakeServer(
  notifications: ApiNotification[],
  initial: Subscriptions,
  refusals: Record<string, FakeAnswer> = {},
) {
  let subscriptions = initial
  return fakeApi((method, path) => {
    const refusal = refusals[`${method} ${path}`]
    if (refusal) return refusal
    if (path === '/api/notifications') return { status: 200, body: notifications }
    if (path === '/api/subscriptions') return { status: 200, body: subscriptions }
    if (path === '/api/projects') return { status: 200, body: [{ id: APOLLO, name: 'Apollo' }] }
    if (path === `/api/projects/${APOLLO}/tasks`)
      return { status: 200, body: [{ id: T, title: 'T' }] }
    if (path === `/api/projects/${APOLLO}`) {
      return { status: 200, body: { id: APOLLO, name: 'Apollo', role: 'contributor' } }
    }
    if (path === `/api/tasks/${T}`) {
      return {
        status: 200,
        body: {
          id: T,
          projectId: APOLLO,
          title: 'T',
          status: 'not-started',
          plannedStart: '2027-03-01',
          plannedFinish: '2027-03-02',
          durationWorkingDays: 2,
          aiShare: null,
          personLoad: 100,
          milestone: null,
          assignees: [ALICE],
          actualFinish: null,
        },
      }
    }
    if (path === `/api/tasks/${T}/relations`) {
      return { status: 200, body: { taskId: T, parent: null, subtasks: [], blockedBy: [] } }
    }
    if (path === `/api/projects/${APOLLO}/members`) {
      return { status: 200, body: [{ accountId: ALICE, username: 'alice', role: 'admin' }] }
    }
    if (method === 'DELETE' && path === `/api/subscriptions/projects/${APOLLO}`) {
      subscriptions = { ...subscriptions, projects: [] }
      return { status: 204 }
    }
    if (method === 'DELETE' && path === `/api/subscriptions/issues/${T}`) {
      subscriptions = { ...subscriptions, issues: [] }
      return { status: 204 }
    }
    return { status: 404, body: { statusCode: 404, error: 'Not Found', message: 'No such route' } }
  })
}

const none: Subscriptions = { projects: [], issues: [] }

function renderPage() {
  render(
    <SignedInContext value={{ id: ALICE, username: 'alice', systemAdmin: false }}>
      <MemoryRouter initialEntries={['/notifications']}>
        <Routes>
          <Route path="notifications" element={<NotificationsPage />} />
          <Route path="sign-in" element={<p>The sign-in page</p>} />
        </Routes>
      </MemoryRouter>
    </SignedInContext>,
  )
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('the in-app notification list (SC-035)', () => {
  it('lists the notifications newest first, each leading to what it is about', async () => {
    fakeServer([overload, waiting], none)
    renderPage()
    const list = await screen.findByRole('list', { name: 'Notifications' })
    const items = within(list).getAllByRole('listitem')
    expect(items.map((item) => item.querySelector('p')?.textContent)).toEqual([
      'You are overloaded on 1 Mar 2027 in Apollo.',
      'A proposal changing Apollo is waiting for your review.',
    ])
    expect(
      within(list).getByRole('link', {
        name: 'A proposal changing Apollo is waiting for your review.',
      }),
    ).toHaveAttribute('href', '/proposals/p1')
  })

  it("opens a task's notification in the task dialog, offering a contributor only FR-107's statuses (#209)", async () => {
    const unavailable: ApiNotification = {
      ...overload,
      id: 'n3',
      detail: {
        flagKind: 'assignee-unavailable',
        projectIds: [APOLLO],
        task: { id: T, projectId: APOLLO },
      },
    }
    const requests = fakeServer([unavailable], none)
    renderPage()
    const list = await screen.findByRole('list', { name: 'Notifications' })
    fireEvent.click(within(list).getByRole('button', { name: /^T in Apollo/ }))
    const dialog = screen.getByRole('dialog')
    const status = await within(dialog).findByRole('combobox', { name: 'Status' })
    expect(
      within(status)
        .getAllByRole('option')
        .map((option) => option.textContent),
    ).toEqual(['Not started', 'In progress', 'On hold', 'Done'])
    expect(within(dialog).queryByRole('textbox')).toBeNull()
    expect(within(dialog).queryByRole('button', { name: 'Add' })).toBeNull()
    expect(within(dialog).getByLabelText('Details')).toHaveTextContent('Assignedalice')

    fireEvent.change(status, { target: { value: 'in-progress' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Change status' }))
    await waitFor(() =>
      expect(requests).toContainEqual({
        method: 'PUT',
        path: `/api/tasks/${T}/status`,
        body: { status: 'in-progress' },
      }),
    )
  })

  it('says when there are none', async () => {
    fakeServer([], none)
    renderPage()
    expect(await screen.findByText('You have no notifications.')).toBeInTheDocument()
    expect(screen.getByText('You are subscribed to no project or issue.')).toBeInTheDocument()
  })

  it('only reads the notifications: it sends nothing that would change them', async () => {
    const requests = fakeServer([overload], none)
    renderPage()
    await screen.findByRole('list', { name: 'Notifications' })
    expect(requests.every((request) => request.method === 'GET')).toBe(true)
  })

  it('sends someone not signed in to the sign-in page', async () => {
    fakeServer([], none, { 'GET /api/notifications': UNAUTHENTICATED })
    renderPage()
    expect(await screen.findByText('The sign-in page')).toBeInTheDocument()
  })
})

describe('the subscriptions on the notification list (SC-093)', () => {
  const both: Subscriptions = {
    projects: [{ projectId: APOLLO, name: 'Apollo', automatic: false }],
    issues: [
      {
        taskId: T,
        projectId: APOLLO,
        repository: { id: REPO, owner: 'csillagu', name: 'tc-repo' },
        number: 1,
      },
    ],
  }

  it('lists them, and unsubscribes from a project', async () => {
    const requests = fakeServer([], both)
    renderPage()
    fireEvent.click(await screen.findByRole('button', { name: 'Unsubscribe from Apollo' }))
    expect(
      await screen.findByRole('button', { name: 'Unsubscribe from csillagu/tc-repo#1' }),
    ).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Unsubscribe from Apollo' })).toBeNull()
    expect(requests).toContainEqual({
      method: 'DELETE',
      path: `/api/subscriptions/projects/${APOLLO}`,
      body: undefined,
    })
  })

  it('unsubscribes from an issue', async () => {
    fakeServer([], both)
    renderPage()
    fireEvent.click(
      await screen.findByRole('button', { name: 'Unsubscribe from csillagu/tc-repo#1' }),
    )
    expect(
      await screen.findByRole('button', { name: 'Unsubscribe from Apollo' }),
    ).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'csillagu/tc-repo#1' })).toBeNull()
  })

  it('offers no unsubscribing from a project their role subscribes them to', async () => {
    fakeServer([], {
      projects: [{ projectId: APOLLO, name: 'Apollo', automatic: true }],
      issues: [],
    })
    renderPage()
    expect(await screen.findByText('Subscribed through your role')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Unsubscribe from Apollo' })).toBeNull()
  })
})

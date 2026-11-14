import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { type FakeAnswer, fakeApi } from '../test/fetch.ts'
import { SubscriptionControl } from './SubscriptionControl.tsx'
import type { Subject, Subscriptions } from './subscriptions.ts'

const APOLLO = '00000000-0000-4000-8000-0000000000a0'
const T = '00000000-0000-4000-8000-000000000011'

/** The subscriptions' API, held as the server would hold them. */
function fakeServer(initial: Subscriptions, refusals: Record<string, FakeAnswer> = {}) {
  let subscriptions = initial
  return fakeApi((method, path) => {
    const refusal = refusals[`${method} ${path}`]
    if (refusal) return refusal
    if (path === '/api/subscriptions') return { status: 200, body: subscriptions }
    if (path === `/api/subscriptions/projects/${APOLLO}`) {
      subscriptions = {
        ...subscriptions,
        projects: method === 'PUT' ? [{ projectId: APOLLO, name: 'Apollo', automatic: false }] : [],
      }
      return { status: 204 }
    }
    if (path === `/api/subscriptions/issues/${T}`) {
      subscriptions = {
        ...subscriptions,
        issues:
          method === 'PUT'
            ? [
                {
                  taskId: T,
                  projectId: APOLLO,
                  repository: { id: 'r', owner: 'csillagu', name: 'tc-repo' },
                  number: 1,
                },
              ]
            : [],
      }
      return { status: 204 }
    }
    return { status: 404, body: { statusCode: 404, error: 'Not Found', message: 'No such route' } }
  })
}

const none: Subscriptions = { projects: [], issues: [] }
const apollo: Subject = { kind: 'project', projectId: APOLLO, name: 'Apollo' }
const issue: Subject = { kind: 'issue', taskId: T, number: 1 }

function renderControl(subject: Subject) {
  render(
    <MemoryRouter>
      <SubscriptionControl subject={subject} />
    </MemoryRouter>,
  )
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('the subscription control (SC-093)', () => {
  it('subscribes to a project, then unsubscribes', async () => {
    const requests = fakeServer(none)
    renderControl(apollo)
    fireEvent.click(await screen.findByRole('button', { name: 'Subscribe to Apollo' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Unsubscribe from Apollo' }))
    expect(await screen.findByRole('button', { name: 'Subscribe to Apollo' })).toBeInTheDocument()
    expect(requests.filter((r) => r.method !== 'GET')).toEqual([
      { method: 'PUT', path: `/api/subscriptions/projects/${APOLLO}`, body: {} },
      { method: 'DELETE', path: `/api/subscriptions/projects/${APOLLO}`, body: undefined },
    ])
  })

  it("subscribes to a task's issue", async () => {
    const requests = fakeServer(none)
    renderControl(issue)
    fireEvent.click(await screen.findByRole('button', { name: 'Subscribe to issue #1' }))
    expect(
      await screen.findByRole('button', { name: 'Unsubscribe from issue #1' }),
    ).toBeInTheDocument()
    expect(requests).toContainEqual({
      method: 'PUT',
      path: `/api/subscriptions/issues/${T}`,
      body: {},
    })
  })

  it('shows a subscription by role, with nothing to unsubscribe', async () => {
    fakeServer({ projects: [{ projectId: APOLLO, name: 'Apollo', automatic: true }], issues: [] })
    renderControl(apollo)
    expect(await screen.findByText('Subscribed through your role')).toBeInTheDocument()
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('shows a refusal in the API’s words', async () => {
    fakeServer(none, {
      [`PUT /api/subscriptions/issues/${T}`]: {
        status: 404,
        body: { statusCode: 404, error: 'Not Found', message: 'The task has no GitHub issue' },
      },
    })
    renderControl(issue)
    fireEvent.click(await screen.findByRole('button', { name: 'Subscribe to issue #1' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('The task has no GitHub issue')
  })
})

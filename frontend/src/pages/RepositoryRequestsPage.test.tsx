import { fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { RepositoryRequest } from '../repositories/request.ts'
import { type FakeAnswer, fakeApi, UNAUTHENTICATED } from '../test/fetch.ts'
import { RepositoryRequestsPage } from './RepositoryRequestsPage.tsx'

const REQUEST = '00000000-0000-4000-8000-000000000003'
const alice = { accountId: '00000000-0000-4000-8000-0000000000a1', username: 'alice' }
const bob = { accountId: '00000000-0000-4000-8000-0000000000b1', username: 'bob' }

function apolloAsks(state: RepositoryRequest['state'] = 'requested'): RepositoryRequest {
  return {
    id: REQUEST,
    project: { id: '00000000-0000-4000-8000-000000000001', name: 'Apollo' },
    repository: {
      id: '00000000-0000-4000-8000-000000000002',
      githubId: 2,
      owner: 'csillagu',
      name: 'tc-repo',
    },
    state,
    requestedBy: alice,
    requestedAt: '2026-11-14T10:00:00.000Z',
    decidedBy: state === 'requested' ? null : bob,
    decidedAt: state === 'requested' ? null : '2026-11-14T11:00:00.000Z',
    withdrawnBy: state === 'withdrawn' ? bob : null,
    withdrawnAt: state === 'withdrawn' ? '2026-11-14T12:00:00.000Z' : null,
  }
}

const NEXT: Record<string, RepositoryRequest['state']> = {
  approve: 'approved',
  reject: 'rejected',
  withdraw: 'withdrawn',
}

/** The inbox's API, with Apollo's one request held as the server would hold it. */
function fakeInbox(
  initial: RepositoryRequest[],
  refusals: Record<string, FakeAnswer> = {},
): ReturnType<typeof fakeApi> {
  let requests = initial
  return fakeApi((method, path) => {
    const refusal = refusals[`${method} ${path}`]
    if (refusal) return refusal
    if (method === 'GET' && path === '/api/repository-requests') {
      return { status: 200, body: requests }
    }
    const decided = /^\/api\/repository-requests\/([^/]+)\/(approve|reject|withdraw)$/.exec(path)
    if (method === 'POST' && decided) {
      requests = requests.map((r) =>
        r.id === decided[1] ? { ...apolloAsks(NEXT[decided[2] ?? ''] ?? 'requested') } : r,
      )
      return { status: 200, body: requests.find((r) => r.id === decided[1]) }
    }
    return { status: 404, body: { statusCode: 404, error: 'Not Found', message: 'No such route' } }
  })
}

function renderPage() {
  render(
    <MemoryRouter initialEntries={['/repository-requests']}>
      <Routes>
        <Route path="repository-requests" element={<RepositoryRequestsPage />} />
        <Route path="sign-in" element={<p>The sign-in page</p>} />
      </Routes>
    </MemoryRouter>,
  )
}

const rowsOf = async (name: string) =>
  within(await screen.findByRole('table', { name }))
    .getAllByRole('row')
    .slice(1)
    .map((row) => row.textContent)

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('the repository request inbox (SC-087)', () => {
  it('lists a waiting request with who asked, and leads to the repository', async () => {
    fakeInbox([apolloAsks()])
    renderPage()
    expect(await rowsOf('Waiting for approval')).toEqual([
      'Apollocsillagu/tc-repoAsked by aliceApproveReject',
    ])
    expect(screen.getByRole('link', { name: 'csillagu/tc-repo' })).toHaveAttribute(
      'href',
      '/repositories/00000000-0000-4000-8000-000000000002',
    )
    expect(screen.getByText('No approval is in force.')).toBeInTheDocument()
    expect(screen.queryByRole('table', { name: 'Rejected and withdrawn' })).toBeNull()
  })

  it('approves a waiting request (FR-168), and lists it as approved', async () => {
    const requests = fakeInbox([apolloAsks()])
    renderPage()
    fireEvent.click(
      await screen.findByRole('button', { name: "Approve Apollo's request for csillagu/tc-repo" }),
    )
    expect(await screen.findByRole('status')).toHaveTextContent(
      'csillagu/tc-repo is added to Apollo.',
    )
    expect(await rowsOf('Approved')).toEqual([
      'Apollocsillagu/tc-repoApproved by bobWithdraw approval',
    ])
    expect(screen.getByText('No request is waiting.')).toBeInTheDocument()
    expect(requests).toContainEqual({
      method: 'POST',
      path: `/api/repository-requests/${REQUEST}/approve`,
      body: {},
    })
  })

  it('rejects a waiting request (FR-171), which then cannot be approved', async () => {
    fakeInbox([apolloAsks()])
    renderPage()
    fireEvent.click(
      await screen.findByRole('button', { name: "Reject Apollo's request for csillagu/tc-repo" }),
    )
    expect(await screen.findByRole('status')).toHaveTextContent(
      "Apollo's request for csillagu/tc-repo is rejected.",
    )
    expect(await rowsOf('Rejected and withdrawn')).toEqual([
      'Apollocsillagu/tc-repoRejected by bob',
    ])
    expect(screen.queryByRole('button', { name: /^Approve / })).toBeNull()
  })

  it('withdraws an approval in force (FR-172)', async () => {
    fakeInbox([apolloAsks('approved')])
    renderPage()
    fireEvent.click(
      await screen.findByRole('button', {
        name: "Withdraw the approval of Apollo's request for csillagu/tc-repo",
      }),
    )
    expect(await screen.findByRole('status')).toHaveTextContent(
      'Apollo no longer pulls issues from csillagu/tc-repo.',
    )
    expect(await rowsOf('Rejected and withdrawn')).toEqual([
      'Apollocsillagu/tc-repoWithdrawn by bob',
    ])
    expect(screen.getByText('No approval is in force.')).toBeInTheDocument()
  })

  it('shows a refusal in the API’s words, and lists the requests afresh', async () => {
    const requests = fakeInbox([apolloAsks()], {
      [`POST /api/repository-requests/${REQUEST}/approve`]: {
        status: 409,
        body: { statusCode: 409, error: 'Conflict', message: 'The request is no longer waiting' },
      },
    })
    renderPage()
    fireEvent.click(
      await screen.findByRole('button', { name: "Approve Apollo's request for csillagu/tc-repo" }),
    )
    expect(await screen.findByRole('alert')).toHaveTextContent('The request is no longer waiting')
    expect(requests.filter((r) => r.method === 'GET')).toHaveLength(2)
  })

  it('says so when no project has asked for a repository the person administers', async () => {
    fakeInbox([])
    renderPage()
    expect(
      await screen.findByText('No project has asked for a repository you are an admin of.'),
    ).toBeInTheDocument()
    expect(screen.queryByRole('table')).toBeNull()
  })

  it('sends someone not signed in to the sign-in page', async () => {
    fakeApi(() => UNAUTHENTICATED)
    renderPage()
    expect(await screen.findByText('The sign-in page')).toBeInTheDocument()
  })
})

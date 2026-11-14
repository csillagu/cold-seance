import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ProjectRepository } from '../repositories/project-settings.ts'
import type { RepositoryRequest } from '../repositories/request.ts'
import { type FakeAnswer, fakeApi } from '../test/fetch.ts'
import { ProjectPage } from './ProjectPage.tsx'
import { ProjectRepositoriesPage } from './ProjectRepositoriesPage.tsx'

const APOLLO = '00000000-0000-4000-8000-000000000001'
const TC_REPO = '00000000-0000-4000-8000-000000000002'
const BASE = `/api/projects/${APOLLO}`
const RECEIVING = `${BASE}/receiving-repositories/${TC_REPO}`

const tcRepo: ProjectRepository = { id: TC_REPO, githubId: 2, owner: 'csillagu', name: 'tc-repo' }
const alice = { accountId: '00000000-0000-4000-8000-0000000000a1', username: 'alice' }

function requestFor(state: RepositoryRequest['state']): RepositoryRequest {
  return {
    id: '00000000-0000-4000-8000-000000000003',
    project: { id: APOLLO, name: 'Apollo' },
    repository: tcRepo,
    state,
    requestedBy: alice,
    requestedAt: '2026-11-14T10:00:00.000Z',
    decidedBy: state === 'approved' ? alice : null,
    decidedAt: state === 'approved' ? '2026-11-14T10:00:00.000Z' : null,
    withdrawnBy: null,
    withdrawnAt: null,
  }
}

/**
 * Apollo's API, with its repositories, requests and receiving role held as the server would hold
 * them. `asked` is the state a new request gets: approved for an admin of both (FR-170).
 */
function fakeApollo(
  options: {
    asked?: RepositoryRequest['state']
    pulled?: boolean
    refusals?: Record<string, FakeAnswer>
  } = {},
) {
  let requests: RepositoryRequest[] = options.pulled ? [requestFor('approved')] : []
  let receiving = false
  const pulled = () => requests.some((r) => r.state === 'approved')
  return fakeApi((method, path) => {
    const refusal = options.refusals?.[`${method} ${path}`]
    if (refusal) return refusal
    if (path === BASE) return { status: 200, body: { id: APOLLO, name: 'Apollo' } }
    if (method === 'GET' && path === `${BASE}/repositories`) {
      return { status: 200, body: pulled() ? [tcRepo] : [] }
    }
    if (method === 'GET' && path === `${BASE}/receiving-repositories`) {
      return { status: 200, body: receiving ? [{ repository: tcRepo, pulls: pulled() }] : [] }
    }
    if (method === 'GET' && path === `${BASE}/repository-requests`) {
      return { status: 200, body: requests }
    }
    if (method === 'POST' && path === `${BASE}/repository-requests`) {
      requests = [requestFor(options.asked ?? 'requested')]
      return { status: 201, body: requests[0] }
    }
    if (method === 'GET' && path === '/api/repositories') {
      return { status: 200, body: [{ ...tcRepo, admins: [] }] }
    }
    if (method === 'PUT' && path === RECEIVING) {
      receiving = true
      return { status: 200, body: { repository: tcRepo, pulls: true } }
    }
    if (method === 'DELETE' && path === RECEIVING) {
      receiving = false
      return { status: 204 }
    }
    return { status: 404, body: { statusCode: 404, error: 'Not Found', message: 'No such route' } }
  })
}

function renderPage() {
  render(
    <MemoryRouter initialEntries={[`/projects/${APOLLO}/repositories`]}>
      <Routes>
        <Route path="projects/:projectId" element={<ProjectPage />}>
          <Route path="repositories" element={<ProjectRepositoriesPage />} />
        </Route>
      </Routes>
    </MemoryRouter>,
  )
}

const rowsOf = (name: string) =>
  within(screen.getByRole('table', { name }))
    .getAllByRole('row')
    .slice(1)
    .map((row) => row.textContent)

const PULLED = 'Repositories Apollo pulls issues from'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('the project repository settings screen (SC-081)', () => {
  it("is a tab of the project's page", async () => {
    fakeApollo()
    renderPage()
    expect(await screen.findByText('Apollo pulls issues from no repository.')).toBeVisible()
    expect(screen.getByRole('link', { name: 'Repositories' })).toHaveAttribute(
      'href',
      `/projects/${APOLLO}/repositories`,
    )
    expect(screen.getByText('No request is waiting.')).toBeVisible()
  })

  it("asks to add a repository, which then waits for its admins' approval (FR-142)", async () => {
    const requests = fakeApollo()
    renderPage()
    fireEvent.change(await screen.findByLabelText('Repository'), { target: { value: TC_REPO } })
    fireEvent.click(screen.getByRole('button', { name: 'Add repository' }))
    expect(await screen.findByRole('status')).toHaveTextContent(
      "Apollo's request for csillagu/tc-repo waits for one of its admins to approve it.",
    )
    expect(requests).toContainEqual({
      method: 'POST',
      path: `${BASE}/repository-requests`,
      body: { repositoryId: TC_REPO },
    })
    await waitFor(() => expect(rowsOf('Waiting for approval')).toEqual(['csillagu/tc-repoalice']))
    expect(screen.getByText('Apollo pulls issues from no repository.')).toBeVisible()
    // Waiting, it is offered no more.
    expect(screen.queryByLabelText('Repository')).toBeNull()
  })

  it('adds the repository at once for an admin of both (FR-170)', async () => {
    fakeApollo({ asked: 'approved' })
    renderPage()
    fireEvent.change(await screen.findByLabelText('Repository'), { target: { value: TC_REPO } })
    fireEvent.click(screen.getByRole('button', { name: 'Add repository' }))
    expect(await screen.findByRole('status')).toHaveTextContent(
      'csillagu/tc-repo is added to Apollo.',
    )
    await waitFor(() =>
      expect(rowsOf(PULLED)).toEqual(['csillagu/tc-repoNot this projectMark as receiving']),
    )
    expect(screen.getByText('No request is waiting.')).toBeVisible()
  })

  it("shows the API's refusal in its own words", async () => {
    fakeApollo({
      refusals: {
        [`POST ${BASE}/repository-requests`]: {
          status: 403,
          body: { statusCode: 403, error: 'Forbidden', message: 'Only the project’s admins can' },
        },
      },
    })
    renderPage()
    fireEvent.change(await screen.findByLabelText('Repository'), { target: { value: TC_REPO } })
    fireEvent.click(screen.getByRole('button', { name: 'Add repository' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Only the project’s admins can')
  })
})

describe('the receiving project control (SC-112)', () => {
  it('marks the project as receiving and gives the role up (FR-143, FR-180)', async () => {
    const requests = fakeApollo({ pulled: true })
    renderPage()
    fireEvent.click(
      await screen.findByRole('button', { name: 'Mark Apollo as receiving csillagu/tc-repo' }),
    )
    expect(await screen.findByRole('status')).toHaveTextContent(
      'Apollo is now the receiving project of csillagu/tc-repo.',
    )
    expect(requests).toContainEqual({ method: 'PUT', path: RECEIVING, body: {} })
    await waitFor(() => expect(rowsOf(PULLED)).toEqual(['csillagu/tc-repoApolloGive up receiving']))

    fireEvent.click(screen.getByRole('button', { name: 'Give up receiving csillagu/tc-repo' }))
    expect(await screen.findByRole('status')).toHaveTextContent(
      'Apollo is no longer the receiving project of csillagu/tc-repo.',
    )
    expect(requests).toContainEqual({ method: 'DELETE', path: RECEIVING, body: undefined })
    await waitFor(() =>
      expect(rowsOf(PULLED)).toEqual(['csillagu/tc-repoNot this projectMark as receiving']),
    )
  })

  it('shows the marking refused while another project holds the role', async () => {
    fakeApollo({
      pulled: true,
      refusals: {
        [`PUT ${RECEIVING}`]: {
          status: 409,
          body: {
            statusCode: 409,
            error: 'Conflict',
            message: 'Another project is the receiving project of this repository',
          },
        },
      },
    })
    renderPage()
    fireEvent.click(
      await screen.findByRole('button', { name: 'Mark Apollo as receiving csillagu/tc-repo' }),
    )
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Another project is the receiving project of this repository',
    )
    await waitFor(() =>
      expect(rowsOf(PULLED)).toEqual(['csillagu/tc-repoNot this projectMark as receiving']),
    )
  })
})

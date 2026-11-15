import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ProjectRepository } from '../repositories/project-settings.ts'
import { type FakeAnswer, fakeApi } from '../test/fetch.ts'
import { ProjectPage } from './ProjectPage.tsx'
import { ProjectSeedingPage } from './ProjectSeedingPage.tsx'

const APOLLO = '00000000-0000-4000-8000-000000000001'
const TC_SEED = '00000000-0000-4000-8000-000000000002'
const TC_MORE = '00000000-0000-4000-8000-000000000003'
const BASE = `/api/projects/${APOLLO}`

const tcSeed: ProjectRepository = { id: TC_SEED, githubId: 2, owner: 'csillagu', name: 'tc-seed' }
const tcMore: ProjectRepository = { id: TC_MORE, githubId: 3, owner: 'csillagu', name: 'tc-more' }

/** Apollo's API, pulling issues from `pulled`, answering the seeding with `seeding`. */
function fakeApollo(pulled: ProjectRepository[], seeding?: FakeAnswer) {
  return fakeApi((method, path) => {
    if (path === BASE) return { status: 200, body: { id: APOLLO, name: 'Apollo' } }
    if (method === 'GET' && path === `${BASE}/repositories`) return { status: 200, body: pulled }
    if (method === 'POST' && path === `${BASE}/seeding` && seeding) return seeding
    return { status: 404, body: { statusCode: 404, error: 'Not Found', message: 'No such route' } }
  })
}

function renderPage() {
  render(
    <MemoryRouter initialEntries={[`/projects/${APOLLO}/seeding`]}>
      <Routes>
        <Route path="projects/:projectId" element={<ProjectPage />}>
          <Route path="seeding" element={<ProjectSeedingPage />} />
        </Route>
      </Routes>
    </MemoryRouter>,
  )
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('the project seeding screen (SC-095)', () => {
  it("is a tab of the project's page, and offers nothing without a repository", async () => {
    fakeApollo([])
    renderPage()
    expect(
      await screen.findByText(/Apollo pulls issues from no repository, so there is none/),
    ).toBeVisible()
    expect(screen.getByRole('link', { name: 'Seeding' })).toHaveAttribute(
      'href',
      `/projects/${APOLLO}/seeding`,
    )
    expect(screen.queryByRole('button', { name: 'Start seeding' })).toBeNull()
  })

  it('offers the repositories the project pulls from, and starts only once one is chosen', async () => {
    fakeApollo([tcSeed, tcMore])
    renderPage()
    const boxes = await screen.findAllByRole('checkbox')
    expect(boxes.map((box) => box.parentElement?.textContent)).toEqual([
      'csillagu/tc-more',
      'csillagu/tc-seed',
    ])
    expect(screen.getByRole('button', { name: 'Start seeding' })).toBeDisabled()
    fireEvent.click(screen.getByRole('checkbox', { name: 'csillagu/tc-seed' }))
    expect(screen.getByRole('button', { name: 'Start seeding' })).toBeEnabled()
  })

  it('seeds from the chosen repositories and says it succeeded (FR-102)', async () => {
    const requests = fakeApollo([tcSeed, tcMore], {
      status: 200,
      body: {
        projectId: APOLLO,
        imported: [1, 2, 3].map((n) => ({
          taskId: `t${n}`,
          repositoryId: TC_SEED,
          issueNumber: n,
        })),
        skipped: [],
      },
    })
    renderPage()
    fireEvent.click(await screen.findByRole('checkbox', { name: 'csillagu/tc-seed' }))
    fireEvent.click(screen.getByRole('checkbox', { name: 'csillagu/tc-more' }))
    fireEvent.click(screen.getByRole('button', { name: 'Start seeding' }))
    expect(await screen.findByRole('status')).toHaveTextContent(
      'The seeding succeeded: 3 tasks imported.',
    )
    expect(requests).toContainEqual({
      method: 'POST',
      path: `${BASE}/seeding`,
      body: { repositoryIds: [TC_SEED, TC_MORE] },
    })
    expect(screen.getByRole('checkbox', { name: 'csillagu/tc-seed' })).not.toBeChecked()
  })

  it('says the import failed as a whole and brought nothing in (FR-137)', async () => {
    fakeApollo([tcSeed], {
      status: 503,
      body: {
        statusCode: 503,
        error: 'Service Unavailable',
        message: 'The seeding failed: GitHub could not be read. Nothing was imported.',
      },
    })
    renderPage()
    fireEvent.click(await screen.findByRole('checkbox', { name: 'csillagu/tc-seed' }))
    fireEvent.click(screen.getByRole('button', { name: 'Start seeding' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'The seeding failed: GitHub could not be read. Nothing was imported.',
    )
  })

  it("shows a refusal in the API's own words", async () => {
    fakeApollo([tcSeed], {
      status: 403,
      body: { statusCode: 403, error: 'Forbidden', message: 'Only the project’s admins can' },
    })
    renderPage()
    fireEvent.click(await screen.findByRole('checkbox', { name: 'csillagu/tc-seed' }))
    fireEvent.click(screen.getByRole('button', { name: 'Start seeding' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Only the project’s admins can. Nothing was imported.',
    )
  })
})

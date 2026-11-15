import { fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ProjectsChangedContext } from '../projects-changed.ts'
import { SignedInContext } from '../signed-in.ts'
import { type FakeAnswer, fakeApi } from '../test/fetch.ts'
import { GroupPage } from './GroupPage.tsx'
import { GroupProjectsPage } from './GroupProjectsPage.tsx'

const PLATFORM = { id: '00000000-0000-4000-8000-0000000000c1', name: 'Platform' }
const APOLLO = { id: '00000000-0000-4000-8000-000000000001', name: 'Apollo' }
const DELTA = { id: '00000000-0000-4000-8000-000000000004', name: 'Delta' }
const ALICE = '00000000-0000-4000-8000-0000000000a1'
const PROJECTS = `/api/groups/${PLATFORM.id}/projects`

/** Platform's API, its projects held as the server would hold them. */
function fakePlatform(refusals: Record<string, FakeAnswer> = {}) {
  let inGroup: (typeof APOLLO)[] = []
  let visible = [APOLLO]
  return fakeApi((method, path) => {
    const refusal = refusals[`${method} ${path}`]
    if (refusal) return refusal
    if (path === '/api/groups') return { status: 200, body: [PLATFORM] }
    if (method === 'GET' && path === PROJECTS) return { status: 200, body: inGroup }
    if (method === 'GET' && path === '/api/projects') return { status: 200, body: visible }
    if (method === 'PUT' && path === `${PROJECTS}/${APOLLO.id}`) {
      inGroup = [APOLLO]
      return { status: 200, body: APOLLO }
    }
    if (method === 'POST' && path === '/api/projects') {
      inGroup = [...inGroup, DELTA]
      visible = [APOLLO, DELTA]
      return { status: 201, body: DELTA }
    }
    return { status: 404, body: { statusCode: 404, error: 'Not Found', message: 'No such route' } }
  })
}

function renderProjects(projectsChanged = () => {}) {
  render(
    <SignedInContext value={{ id: ALICE, username: 'alice', systemAdmin: false }}>
      <ProjectsChangedContext value={projectsChanged}>
        <MemoryRouter initialEntries={[`/groups/${PLATFORM.id}/projects`]}>
          <Routes>
            <Route path="groups/:groupId" element={<GroupPage />}>
              <Route path="projects" element={<GroupProjectsPage />} />
            </Route>
          </Routes>
        </MemoryRouter>
      </ProjectsChangedContext>
    </SignedInContext>,
  )
}

const listed = () =>
  within(screen.getByRole('list', { name: 'Projects of Platform' }))
    .getAllByRole('link')
    .map((link) => link.textContent)

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('the group projects screen (SC-084)', () => {
  it('adds an existing project the person can see, and lists it', async () => {
    const requests = fakePlatform()
    renderProjects()
    expect(await screen.findByText('No project you can see is in this group.')).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Project'), { target: { value: APOLLO.id } })
    fireEvent.click(screen.getByRole('button', { name: 'Add project' }))
    expect(await screen.findByRole('status')).toHaveTextContent('Apollo is now in Platform.')
    expect(listed()).toEqual(['Apollo'])
    expect(
      screen.getByText('Every project you can see is in this group already.'),
    ).toBeInTheDocument()
    expect(requests.filter((r) => r.method !== 'GET')).toEqual([
      { method: 'PUT', path: `${PROJECTS}/${APOLLO.id}`, body: undefined },
    ])
  })

  it("shows a refused addition in the API's words, and lists nothing new", async () => {
    fakePlatform({
      [`PUT ${PROJECTS}/${APOLLO.id}`]: {
        status: 403,
        body: {
          statusCode: 403,
          error: 'Forbidden',
          message: "Only the project's admins can add it to a group",
        },
      },
    })
    renderProjects()
    await screen.findByText('No project you can see is in this group.')
    fireEvent.change(screen.getByLabelText('Project'), { target: { value: APOLLO.id } })
    fireEvent.click(screen.getByRole('button', { name: 'Add project' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(
      "Only the project's admins can add it to a group",
    )
    expect(screen.getByText('No project you can see is in this group.')).toBeInTheDocument()
  })

  it('creates a new project in the group and tells the layout the projects changed', async () => {
    const requests = fakePlatform()
    const projectsChanged = vi.fn<() => void>()
    renderProjects(projectsChanged)
    await screen.findByText('No project you can see is in this group.')
    fireEvent.change(screen.getByLabelText('Project name'), { target: { value: 'Delta' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create project' }))
    expect(await screen.findByRole('status')).toHaveTextContent(
      'Project Delta is created in Platform, and you are its admin.',
    )
    expect(listed()).toEqual(['Delta'])
    expect(projectsChanged).toHaveBeenCalled()
    expect(requests.filter((r) => r.method !== 'GET')).toEqual([
      { method: 'POST', path: '/api/projects', body: { name: 'Delta', groupIds: [PLATFORM.id] } },
    ])
  })
})

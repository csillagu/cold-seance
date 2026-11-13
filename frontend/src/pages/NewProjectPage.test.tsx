import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useParams } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ProjectsChangedContext } from '../projects-changed.ts'
import { fakeApi } from '../test/fetch.ts'
import { NewProjectPage } from './NewProjectPage.tsx'

const APOLLO = '00000000-0000-4000-8000-000000000001'

function Opened() {
  const { projectId } = useParams()
  return <p>Opened {projectId}</p>
}

function renderForm(projectsChanged = () => {}) {
  render(
    <ProjectsChangedContext value={projectsChanged}>
      <MemoryRouter initialEntries={['/projects/new']}>
        <Routes>
          <Route path="projects/new" element={<NewProjectPage />} />
          <Route path="projects/:projectId" element={<Opened />} />
        </Routes>
      </MemoryRouter>
    </ProjectsChangedContext>,
  )
}

const create = (name: string) => {
  fireEvent.change(screen.getByLabelText('Project name'), { target: { value: name } })
  fireEvent.click(screen.getByRole('button', { name: 'Create project' }))
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('the project creation form (SC-079)', () => {
  it('creates the project (FR-119), tells the layout, and opens its page', async () => {
    const requests = fakeApi(() => ({ status: 201, body: { id: APOLLO, name: 'Apollo' } }))
    const projectsChanged = vi.fn<() => void>()
    renderForm(projectsChanged)
    create('Apollo')
    expect(await screen.findByText(`Opened ${APOLLO}`)).toBeDefined()
    expect(requests).toEqual([{ method: 'POST', path: '/api/projects', body: { name: 'Apollo' } }])
    expect(projectsChanged).toHaveBeenCalledTimes(1)
  })

  it("shows the API's refusal of a name already used (FR-120) and stays on the form", async () => {
    fakeApi(() => ({
      status: 409,
      body: {
        statusCode: 409,
        error: 'Conflict',
        message: 'A project named Apollo already exists',
      },
    }))
    const projectsChanged = vi.fn<() => void>()
    renderForm(projectsChanged)
    create('Apollo')
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'A project named Apollo already exists',
    )
    expect(screen.getByLabelText('Project name')).toHaveValue('Apollo')
    expect(screen.getByRole('button', { name: 'Create project' })).toBeEnabled()
    expect(projectsChanged).not.toHaveBeenCalled()
  })
})

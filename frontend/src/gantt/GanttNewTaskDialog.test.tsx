import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { ApiError } from '../api.ts'
import { GanttNewTaskDialog, type NewTask } from './GanttNewTaskDialog.tsx'

const apollo = { id: 'apollo', name: 'Apollo', writable: true }
const borealis = { id: 'borealis', name: 'Borealis', writable: true }
const ceres = { id: 'ceres', name: 'Ceres', writable: false }

function open(projects = [apollo], filteredTo: string[] | null = null) {
  const onCreate = vi.fn<(projectId: string, task: NewTask) => Promise<void>>(async () => {})
  const onClose = vi.fn<() => void>()
  render(
    <GanttNewTaskDialog
      projects={projects}
      filteredTo={filteredTo}
      onCreate={onCreate}
      onClose={onClose}
    />,
  )
  return { onCreate, onClose, dialog: screen.getByRole('dialog', { name: 'New task' }) }
}

describe('creating a task on the Gantt (SC-067)', () => {
  it("creates it in the Gantt's one project, with its title, start and duration", async () => {
    const { onCreate, onClose, dialog } = open()
    expect(within(dialog).queryByLabelText('Project')).toBeNull()
    fireEvent.change(within(dialog).getByLabelText('Title'), { target: { value: 'New work' } })
    fireEvent.change(within(dialog).getByLabelText('Planned start'), {
      target: { value: '2027-03-01' },
    })
    fireEvent.change(within(dialog).getByLabelText('Duration in working days'), {
      target: { value: '3' },
    })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create' }))
    await waitFor(() => expect(onClose).toHaveBeenCalled())
    expect(onCreate).toHaveBeenCalledWith('apollo', {
      title: 'New work',
      plannedStart: '2027-03-01',
      durationWorkingDays: 3,
    })
  })

  it('creates a milestone for a duration of 0: fixed to the start, or floating (TC-286)', async () => {
    const { onCreate, onClose, dialog } = open()
    fireEvent.change(within(dialog).getByLabelText('Title'), { target: { value: 'Launch' } })
    fireEvent.change(within(dialog).getByLabelText('Duration in working days'), {
      target: { value: '0' },
    })
    expect(within(dialog).getByText(/a floating milestone/)).toBeInTheDocument()
    fireEvent.change(within(dialog).getByLabelText('Planned start'), {
      target: { value: '2027-03-12' },
    })
    expect(within(dialog).getByText(/a milestone fixed to the planned start/)).toBeInTheDocument()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create' }))
    await waitFor(() => expect(onClose).toHaveBeenCalled())
    expect(onCreate).toHaveBeenCalledWith('apollo', {
      title: 'Launch',
      milestone: { variant: 'fixed-date', date: '2027-03-12' },
    })
  })

  it('creates a floating milestone for a duration of 0 and no start (TC-286)', async () => {
    const { onCreate, dialog } = open()
    fireEvent.change(within(dialog).getByLabelText('Title'), { target: { value: 'Docs ready' } })
    fireEvent.change(within(dialog).getByLabelText('Duration in working days'), {
      target: { value: '0' },
    })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create' }))
    await waitFor(() =>
      expect(onCreate).toHaveBeenCalledWith('apollo', {
        title: 'Docs ready',
        milestone: { variant: 'floating' },
      }),
    )
  })

  it('asks for the project on a Gantt of several, offering only writable ones (FR-061)', async () => {
    const { onCreate, dialog } = open([apollo, borealis, ceres])
    const project = within(dialog).getByLabelText('Project')
    const offered = within(project)
      .getAllByRole('option')
      .map((option) => option.textContent)
    expect(offered).toEqual(['Choose a project', 'Apollo', 'Borealis'])
    fireEvent.change(within(dialog).getByLabelText('Title'), { target: { value: 'New work' } })
    fireEvent.change(project, { target: { value: 'borealis' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create' }))
    await waitFor(() => expect(onCreate).toHaveBeenCalledWith('borealis', { title: 'New work' }))
  })

  it("uses the only project the view's filter allows, without asking (FR-061)", async () => {
    const { onCreate, dialog } = open([apollo, borealis], ['borealis'])
    expect(within(dialog).queryByLabelText('Project')).toBeNull()
    fireEvent.change(within(dialog).getByLabelText('Title'), {
      target: { value: 'Filtered work' },
    })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create' }))
    await waitFor(() =>
      expect(onCreate).toHaveBeenCalledWith('borealis', { title: 'Filtered work' }),
    )
  })

  it('says so, and creates nothing, where the viewer can write to no project', () => {
    const { dialog } = open([ceres, { ...apollo, writable: false }])
    expect(
      within(dialog).getByText('You cannot create tasks in any of the projects this Gantt covers.'),
    ).toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: 'Create' })).toBeDisabled()
  })

  it("shows the API's refusal and stays open", async () => {
    const onClose = vi.fn<() => void>()
    render(
      <GanttNewTaskDialog
        projects={[apollo]}
        onCreate={() =>
          Promise.reject(
            new ApiError(403, {
              error: 'Forbidden',
              message: 'You cannot create tasks in this project',
            }),
          )
        }
        onClose={onClose}
      />,
    )
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'New work' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'You cannot create tasks in this project',
    )
    expect(onClose).not.toHaveBeenCalled()
  })
})

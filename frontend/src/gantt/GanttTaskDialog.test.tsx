import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { ApiError } from '../api.ts'
import type { KanbanTask } from '../kanban/kanban-model.ts'
import { GanttTaskDialog, type SaveChange } from './GanttTaskDialog.tsx'

const A: KanbanTask = {
  id: 'a',
  projectId: 'apollo',
  title: 'A',
  status: 'in-progress',
  plannedStart: '2027-03-01',
  plannedFinish: '2027-03-01',
  durationWorkingDays: 1,
  aiShare: null,
  milestone: null,
  assignees: [],
  actualFinish: null,
}
const B: KanbanTask = { ...A, id: 'b', title: 'B', status: 'not-started' }
const C: KanbanTask = { ...A, id: 'c', title: 'C', status: 'not-started' }

function open(save: SaveChange, blockedBy: string[] = ['a'], parent: string | null = null) {
  const onClose = vi.fn<() => void>()
  render(
    <GanttTaskDialog
      task={B}
      tasks={[A, B, C]}
      relations={{
        taskId: 'b',
        parent: parent === null ? null : { id: parent, projectId: 'apollo' },
        blockedBy: blockedBy.map((id) => ({ id, projectId: 'apollo' })),
      }}
      members={[{ accountId: 'alice', username: 'alice' }]}
      save={save}
      onClose={onClose}
    />,
  )
  return { onClose, dialog: screen.getByRole('dialog', { name: 'Edit B' }) }
}

describe("a task's editor on the Gantt (SC-067)", () => {
  it('changes its fields, and closes once they are saved', async () => {
    const save = vi.fn<SaveChange>(async () => {})
    const { dialog, onClose } = open(save)
    fireEvent.change(within(dialog).getByLabelText('Title'), { target: { value: 'B2' } })
    fireEvent.change(within(dialog).getByLabelText('Planned start'), {
      target: { value: '2027-03-03' },
    })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(onClose).toHaveBeenCalled())
    expect(save).toHaveBeenCalledWith('/tasks/b', 'PATCH', {
      title: 'B2',
      plannedStart: '2027-03-03',
    })
  })

  it('changes its status among those it can move to', async () => {
    const save = vi.fn<SaveChange>(async () => {})
    const { dialog } = open(save)
    const status = within(dialog).getByLabelText('Status')
    expect(
      within(status)
        .getAllByRole('option')
        .map((option) => option.textContent),
    ).toEqual(['Not started', 'In progress', 'On hold', 'Done', 'Cancelled'])
    fireEvent.change(status, { target: { value: 'in-progress' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Change status' }))
    await waitFor(() =>
      expect(save).toHaveBeenCalledWith('/tasks/b/status', 'PUT', { status: 'in-progress' }),
    )
    fireEvent.change(status, { target: { value: 'cancelled' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Change status' }))
    await waitFor(() => expect(save).toHaveBeenCalledWith('/tasks/b/cancel', 'POST', {}))
  })

  it('removes and adds the tasks it is blocked by', async () => {
    const save = vi.fn<SaveChange>(async () => {})
    const { dialog } = open(save)
    const blockers = within(dialog).getByRole('list', { name: 'Blocked by' })
    expect(within(blockers).getByText('A')).toBeInTheDocument()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Remove the blocker A' }))
    await waitFor(() =>
      expect(save).toHaveBeenCalledWith('/tasks/b/blocked-by/a', 'DELETE', undefined),
    )

    const add = within(dialog).getByLabelText('Add a blocker')
    // Neither the task itself nor a task it is already blocked by is offered.
    expect(
      within(add)
        .getAllByRole('option')
        .map((option) => option.textContent),
    ).toEqual(['Choose a task', 'C'])
    fireEvent.change(add, { target: { value: 'c' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Add' }))
    await waitFor(() =>
      expect(save).toHaveBeenCalledWith('/tasks/b/blocked-by', 'POST', { blockerId: 'c' }),
    )
  })

  it('names a blocker of another project as such', () => {
    open(async () => {}, ['m-elsewhere'])
    expect(screen.getByText('A milestone of another project')).toBeInTheDocument()
  })

  it('sets its parent, and makes it a subtask of none', async () => {
    const save = vi.fn<SaveChange>(async () => {})
    const { dialog } = open(save, [], 'c')
    const parent = within(dialog).getByLabelText('Subtask of')
    expect(parent).toHaveValue('c')
    fireEvent.change(parent, { target: { value: '' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Set parent' }))
    await waitFor(() =>
      expect(save).toHaveBeenCalledWith('/tasks/b/parent', 'PUT', { parentId: null }),
    )
  })

  it("shows the API's refusal and stays open (FR-060)", async () => {
    const { dialog, onClose } = open(() =>
      Promise.reject(
        new ApiError(403, { error: 'Forbidden', message: 'Your role does not allow this' }),
      ),
    )
    fireEvent.change(within(dialog).getByLabelText('Title'), { target: { value: 'B2' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }))
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      'Your role does not allow this',
    )
    expect(onClose).not.toHaveBeenCalled()
  })
})

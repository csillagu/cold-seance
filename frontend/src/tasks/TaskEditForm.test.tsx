import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { KanbanTask } from '../kanban/kanban-model.ts'
import { EditForm, type TaskChanges } from './TaskEditForm.tsx'

// The person load of an AI-only task in the task dialog's fields (FR-149, SC-100): any percentage,
// 1% offered where the task becomes AI-only. The rest of the dialog is tested in TaskDialog.test.tsx.

const APOLLO = '00000000-0000-4000-8000-000000000001'
const T = '00000000-0000-4000-8000-00000000000a'

const task = (fields: Partial<KanbanTask> = {}): KanbanTask => ({
  id: T,
  projectId: APOLLO,
  title: 'Draft notes',
  status: 'not-started',
  plannedStart: null,
  plannedFinish: null,
  durationWorkingDays: null,
  aiShare: null,
  personLoad: 100,
  milestone: null,
  assignees: [],
  actualFinish: null,
  ...fields,
})

function renderForm(shown: KanbanTask) {
  const onSave = vi.fn<(changes: TaskChanges) => Promise<void>>(async () => {})
  render(<EditForm task={shown} members={[]} onCancel={() => {}} onSave={onSave} />)
  return onSave
}

describe("an AI-only task's person load in the task dialog", () => {
  it('offers 1% once the AI share is set to 100%, and saves it (TC-221)', async () => {
    const onSave = renderForm(task())
    expect(screen.queryByRole('spinbutton', { name: 'Person load in percent' })).toBeNull()

    fireEvent.change(screen.getByRole('spinbutton', { name: 'AI share in percent' }), {
      target: { value: '100' },
    })
    const load = screen.getByRole('spinbutton', { name: 'Person load in percent' })
    expect(load).toHaveValue(1)

    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1))
    expect(onSave.mock.calls[0]?.[0]).toEqual({ aiShare: 100, personLoad: 1 })
  })

  it("shows an AI-only task's own load, not the offer, and sends it only when changed", async () => {
    const onSave = renderForm(task({ aiShare: 100, personLoad: 0 }))
    const load = screen.getByRole('spinbutton', { name: 'Person load in percent' })
    expect(load).toHaveValue(0)

    fireEvent.change(load, { target: { value: '150' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1))
    expect(onSave.mock.calls[0]?.[0]).toEqual({ personLoad: 150 })
  })
})

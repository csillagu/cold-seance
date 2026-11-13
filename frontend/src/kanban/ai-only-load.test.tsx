import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { describe, expect, it, vi } from 'vitest'
import { Kanban, type TaskChanges } from './Kanban.tsx'
import { buildKanbanModel, type KanbanTask } from './kanban-model.ts'

// The person load of an AI-only task in the card's edit form (FR-149, SC-100): any percentage,
// 1% offered where the task becomes AI-only. The rest of the Kanban is tested in KanbanPage.test.tsx.

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

function renderKanban(shown: KanbanTask) {
  const onEdit = vi.fn<(task: KanbanTask, changes: TaskChanges) => Promise<void>>(async () => {})
  render(
    <MemoryRouter>
      <Kanban
        name="Kanban of Apollo"
        model={buildKanbanModel([{ id: APOLLO, name: 'Apollo' }], [shown], [])}
        people={new Map()}
        members={new Map()}
        onMove={async () => {}}
        onEdit={onEdit}
      />
    </MemoryRouter>,
  )
  fireEvent.click(screen.getByRole('button', { name: 'Edit Draft notes' }))
  return onEdit
}

describe("an AI-only task's person load on the Kanban", () => {
  it('offers 1% once the AI share is set to 100%, and saves it (TC-221)', async () => {
    const onEdit = renderKanban(task())
    expect(screen.queryByRole('spinbutton', { name: 'Person load in percent' })).toBeNull()

    fireEvent.change(screen.getByRole('spinbutton', { name: 'AI share in percent' }), {
      target: { value: '100' },
    })
    const load = screen.getByRole('spinbutton', { name: 'Person load in percent' })
    expect(load).toHaveValue(1)

    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(onEdit).toHaveBeenCalledTimes(1))
    expect(onEdit.mock.calls[0]?.[1]).toEqual({ aiShare: 100, personLoad: 1 })
  })

  it("shows an AI-only task's own load, not the offer, and sends it only when changed", async () => {
    const onEdit = renderKanban(task({ aiShare: 100, personLoad: 0 }))
    const load = screen.getByRole('spinbutton', { name: 'Person load in percent' })
    expect(load).toHaveValue(0)

    fireEvent.change(load, { target: { value: '150' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(onEdit).toHaveBeenCalledTimes(1))
    expect(onEdit.mock.calls[0]?.[1]).toEqual({ personLoad: 150 })
  })

  it('leads from the card to the task page', () => {
    render(
      <MemoryRouter>
        <Kanban
          name="Kanban of Apollo"
          model={buildKanbanModel([{ id: APOLLO, name: 'Apollo' }], [task()], [])}
          people={new Map()}
          members={new Map()}
          onMove={async () => {}}
          onEdit={async () => {}}
        />
      </MemoryRouter>,
    )
    expect(screen.getByRole('link', { name: 'Open Draft notes' })).toHaveAttribute(
      'href',
      `/tasks/${T}`,
    )
  })
})

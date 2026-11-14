import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { fakeApi, type FakeAnswer, type FakeRequest } from '../test/fetch.ts'
import { RelationsSection } from './RelationsSection.tsx'

const APOLLO = '00000000-0000-4000-8000-000000000001'
const BOREALIS = '00000000-0000-4000-8000-000000000002'
const A = '00000000-0000-4000-8000-00000000000a'
const B = '00000000-0000-4000-8000-00000000000b'
const C = '00000000-0000-4000-8000-00000000000c'
const M = '00000000-0000-4000-8000-0000000000f1'

const task = (id: string, title: string, projectId = APOLLO, milestone: unknown = null) => ({
  id,
  projectId,
  title,
  milestone,
})
const APOLLO_TASKS = [task(A, 'A'), task(B, 'B'), task(C, 'C')]
const M_TASK = task(M, 'M', BOREALIS, { variant: 'fixed-date', date: '2027-03-12' })

interface Held {
  parent: string | null
  subtasks: string[]
  blockedBy: { id: string; projectId: string }[]
}

const CYCLE: FakeAnswer = {
  status: 400,
  body: { statusCode: 400, error: 'Bad Request', message: 'This relation would create a cycle' },
}
const NOT_VISIBLE: FakeAnswer = {
  status: 403,
  body: { statusCode: 403, error: 'Not Visible', message: 'This project is not visible to you' },
}

/**
 * A fake API in which task A of Apollo has the relations `held`, Borealis (if `borealis`) holds
 * milestone M, and a change is applied, or refused with `refusal`.
 */
function serve(held: Held, options: { borealis?: boolean; refusal?: FakeAnswer } = {}) {
  const relations = () => ({
    taskId: A,
    parent: held.parent === null ? null : { id: held.parent, projectId: APOLLO },
    subtasks: held.subtasks.map((id) => ({ id, projectId: APOLLO })),
    blockedBy: held.blockedBy,
  })
  const requests: FakeRequest[] = fakeApi((method, path) => {
    const sent = requests.at(-1)?.body
    const body = (key: string): string | null => {
      if (typeof sent !== 'object' || sent === null || !(key in sent)) return null
      const value: unknown = Reflect.get(sent, key)
      return typeof value === 'string' ? value : null
    }
    if (method === 'GET' && path === `/api/tasks/${A}/relations`) {
      return { status: 200, body: relations() }
    }
    if (method === 'GET' && path === `/api/projects/${APOLLO}/tasks`) {
      return { status: 200, body: APOLLO_TASKS }
    }
    if (method === 'GET' && path === `/api/projects/${BOREALIS}/tasks`) {
      return { status: 200, body: [M_TASK, task(C, 'Not a milestone', BOREALIS)] }
    }
    if (method === 'GET' && path === `/api/tasks/${M}`) return { status: 200, body: M_TASK }
    if (method === 'GET' && path === '/api/projects') {
      const projects = [{ id: APOLLO, name: 'Apollo' }]
      if (options.borealis) projects.push({ id: BOREALIS, name: 'Borealis' })
      return { status: 200, body: projects }
    }
    if (options.refusal) return options.refusal
    if (method === 'POST' && path === `/api/tasks/${A}/blocked-by`) {
      const id = String(body('blockerId'))
      held.blockedBy.push({ id, projectId: id === M ? BOREALIS : APOLLO })
      return { status: 200, body: relations() }
    }
    if (method === 'DELETE' && path.startsWith(`/api/tasks/${A}/blocked-by/`)) {
      held.blockedBy = held.blockedBy.filter((b) => !path.endsWith(b.id))
      return { status: 200, body: relations() }
    }
    if (method === 'PUT' && path === `/api/tasks/${A}/parent`) {
      held.parent = body('parentId')
      return { status: 200, body: relations() }
    }
    const sub = /^\/api\/tasks\/([0-9a-f-]+)\/parent$/.exec(path)?.[1]
    if (method === 'PUT' && sub) {
      held.subtasks = held.subtasks.filter((id) => id !== sub)
      if (body('parentId') === A) held.subtasks.push(sub)
      return { status: 200, body: {} }
    }
    return { status: 404, body: { statusCode: 404, error: 'Not Found', message: 'Not found' } }
  })
  return requests
}

function renderSection(onChanged = vi.fn<() => Promise<void>>(async () => {})) {
  render(
    <MemoryRouter>
      <RelationsSection
        task={{ id: A, projectId: APOLLO }}
        projectName="Apollo"
        onChanged={onChanged}
      />
    </MemoryRouter>,
  )
  return onChanged
}

const list = (name: string) => screen.getByRole('group', { name })
const choose = (label: string, value: string) =>
  fireEvent.change(screen.getByRole('combobox', { name: label }), { target: { value } })
const changes = (requests: FakeRequest[]) => requests.filter((r) => r.method !== 'GET')

afterEach(() => vi.unstubAllGlobals())

describe('the task relation editor (SC-101)', () => {
  it("shows the parent, the subtasks and the blockers, another project's milestone by its project", async () => {
    serve(
      { parent: C, subtasks: [B], blockedBy: [{ id: M, projectId: BOREALIS }] },
      { borealis: true },
    )
    renderSection()
    expect(await screen.findByText('M (Borealis)')).toBeInTheDocument()
    expect(within(list('Blocked by')).getByText('M (Borealis)')).toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: 'Parent' })).toHaveValue(C)
    expect(within(list('Subtasks')).getByText('B')).toBeInTheDocument()
  })

  it('rejects a blocked-by relation that closes a cycle, with the reason, and keeps the relations (TC-022)', async () => {
    const requests = serve({ parent: null, subtasks: [], blockedBy: [] }, { refusal: CYCLE })
    const onChanged = renderSection()
    await screen.findByText('Not blocked by anything.')
    choose('Add a blocker', B)
    fireEvent.click(screen.getByRole('button', { name: 'Add blocker' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('This relation would create a cycle')
    expect(changes(requests)).toEqual([
      { method: 'POST', path: `/api/tasks/${A}/blocked-by`, body: { blockerId: B } },
    ])
    expect(within(list('Blocked by')).getByText('Not blocked by anything.')).toBeInTheDocument()
    expect(onChanged).not.toHaveBeenCalled()
  })

  it("makes the task blocked by another project's milestone, picked from that project (TC-023)", async () => {
    const requests = serve({ parent: null, subtasks: [], blockedBy: [] }, { borealis: true })
    const onChanged = renderSection()
    await screen.findByText('Not blocked by anything.')
    choose("Blocker's project", BOREALIS)
    const milestones = screen.getByRole('combobox', { name: 'Add a milestone as blocker' })
    await within(milestones).findByRole('option', { name: 'M' })
    // Only the project's milestones are offered.
    expect(within(milestones).queryByRole('option', { name: 'Not a milestone' })).toBeNull()
    choose('Add a milestone as blocker', M)
    fireEvent.click(screen.getByRole('button', { name: 'Add blocker' }))

    expect(await within(list('Blocked by')).findByText('M (Borealis)')).toBeInTheDocument()
    expect(changes(requests)).toEqual([
      { method: 'POST', path: `/api/tasks/${A}/blocked-by`, body: { blockerId: M } },
    ])
    await waitFor(() => expect(onChanged).toHaveBeenCalledOnce())
  })

  it('shows the refusal of a milestone, given by its identifier, of a project the viewer cannot read (TC-024)', async () => {
    const requests = serve({ parent: null, subtasks: [], blockedBy: [] }, { refusal: NOT_VISIBLE })
    renderSection()
    await screen.findByText('Not blocked by anything.')
    // Borealis is not offered: only the projects the viewer can read are.
    expect(screen.queryByRole('option', { name: 'Borealis' })).toBeNull()
    fireEvent.change(screen.getByRole('textbox', { name: "Or a milestone's identifier" }), {
      target: { value: ` ${M} ` },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Add by identifier' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('This project is not visible to you')
    expect(changes(requests)).toEqual([
      { method: 'POST', path: `/api/tasks/${A}/blocked-by`, body: { blockerId: M } },
    ])
    expect(within(list('Blocked by')).getByText('Not blocked by anything.')).toBeInTheDocument()
  })

  it('removes a blocker', async () => {
    const requests = serve({
      parent: null,
      subtasks: [],
      blockedBy: [{ id: B, projectId: APOLLO }],
    })
    renderSection()
    fireEvent.click(await screen.findByRole('button', { name: 'Remove B' }))
    expect(await screen.findByText('Not blocked by anything.')).toBeInTheDocument()
    expect(changes(requests)).toEqual([
      { method: 'DELETE', path: `/api/tasks/${A}/blocked-by/${B}`, body: undefined },
    ])
  })

  it('sets the parent, and none', async () => {
    const requests = serve({ parent: null, subtasks: [], blockedBy: [] })
    renderSection()
    await screen.findByText('No subtasks.')
    // The task itself is not offered as its own parent.
    expect(
      within(screen.getByRole('combobox', { name: 'Parent' })).queryByRole('option', { name: 'A' }),
    ).toBeNull()
    choose('Parent', C)
    fireEvent.click(screen.getByRole('button', { name: 'Save parent' }))
    await waitFor(() => expect(screen.getByRole('combobox', { name: 'Parent' })).toHaveValue(C))
    choose('Parent', '')
    fireEvent.click(screen.getByRole('button', { name: 'Save parent' }))
    await waitFor(() => expect(changes(requests)).toHaveLength(2))
    expect(changes(requests).map((r) => r.body)).toEqual([{ parentId: C }, { parentId: null }])
  })

  it("adds and removes a subtask by setting the subtask's parent", async () => {
    const requests = serve({ parent: null, subtasks: [], blockedBy: [] })
    renderSection()
    await screen.findByText('No subtasks.')
    choose('Add a subtask', B)
    fireEvent.click(screen.getByRole('button', { name: 'Add subtask' }))
    fireEvent.click(await within(list('Subtasks')).findByRole('button', { name: 'Remove B' }))
    expect(await screen.findByText('No subtasks.')).toBeInTheDocument()
    expect(changes(requests)).toEqual([
      { method: 'PUT', path: `/api/tasks/${B}/parent`, body: { parentId: A } },
      { method: 'PUT', path: `/api/tasks/${B}/parent`, body: { parentId: null } },
    ])
  })
})

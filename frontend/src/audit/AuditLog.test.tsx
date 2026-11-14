import { fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { formatWhen } from '../proposals/proposal.ts'
import { type FakeAnswer, fakeApi } from '../test/fetch.ts'
import { AuditLog, PAGE_SIZE } from './AuditLog.tsx'
import type { AuditEntry } from './audit-entry.ts'

const APOLLO = '6f1c2a5e-0000-4000-8000-0000000000a1'
const BOREALIS = '6f1c2a5e-0000-4000-8000-0000000000b1'

function entry(id: number, fields: Partial<AuditEntry> = {}): AuditEntry {
  return {
    id,
    at: '2027-02-01T09:30:00.000Z',
    by: { accountId: '6f1c2a5e-0000-4000-8000-00000000a11c', username: 'alice' },
    channels: ['ui'],
    projectId: APOLLO,
    action: 'task.updated',
    subject: { type: 'task', id: '6f1c2a5e-0000-4000-8000-0000000000aa' },
    details: { changes: { title: 'Final' }, previous: { title: 'Draft' } },
    ...fields,
  }
}

function renderLog(props: Parameters<typeof AuditLog>[0] = {}) {
  render(
    <MemoryRouter>
      <AuditLog {...props} />
    </MemoryRouter>,
  )
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('the audit log viewer (SC-094)', () => {
  it('shows each entry with who, when, through which channel and what changed', async () => {
    const requests = fakeApi(() => ({ status: 200, body: [entry(2, { channels: ['rest-api'] })] }))
    renderLog({ projectId: APOLLO })
    const table = await screen.findByRole('table', { name: 'Audit log' })
    const row = within(table).getAllByRole('row')[1]
    expect(row).toHaveTextContent(formatWhen('2027-02-01T09:30:00.000Z'))
    expect(row).toHaveTextContent('alice')
    expect(row).toHaveTextContent('REST API')
    expect(row).toHaveTextContent('Task updated')
    expect(row).toHaveTextContent('title: Draft → Final')
    // A project's part of the log: no project column.
    expect(within(table).queryByRole('columnheader', { name: 'Project' })).toBeNull()
    expect(requests[0]?.path).toBe(`/api/audit-log?limit=${PAGE_SIZE + 1}&projectId=${APOLLO}`)
  })

  it('shows the whole log with each entry’s project, by name where it is known', async () => {
    const requests = fakeApi(() => ({
      status: 200,
      body: [entry(3, { projectId: BOREALIS }), entry(2), entry(1, { projectId: null })],
    }))
    renderLog({ projectNames: new Map([[APOLLO, 'Apollo']]) })
    const table = await screen.findByRole('table', { name: 'Audit log' })
    const rows = within(table).getAllByRole('row')
    expect(rows[1]).toHaveTextContent(BOREALIS)
    expect(rows[2]).toHaveTextContent('Apollo')
    expect(rows[3]).toHaveTextContent('None')
    expect(requests[0]?.path).toBe(`/api/audit-log?limit=${PAGE_SIZE + 1}`)
  })

  it('shows the refusal, and nothing of the log, to someone who may not read it', async () => {
    fakeApi(() => ({
      status: 403,
      body: {
        statusCode: 403,
        error: 'Forbidden',
        message: 'Only system admins can read the whole audit log',
      },
    }))
    renderLog()
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Only system admins can read the whole audit log',
    )
    expect(screen.queryByRole('table')).toBeNull()
  })

  it('says so when the log holds no entries', async () => {
    fakeApi(() => ({ status: 200, body: [] }))
    renderLog()
    expect(await screen.findByText('The audit log holds no entries yet.')).toBeInTheDocument()
  })

  it('reads older entries a page at a time', async () => {
    const first = Array.from({ length: PAGE_SIZE + 1 }, (_, index) => entry(200 - index))
    const answer = (_method: string, path: string): FakeAnswer =>
      path.includes('before=')
        ? { status: 200, body: [entry(10, { action: 'task.created', details: {} })] }
        : { status: 200, body: first }
    const requests = fakeApi(answer)
    renderLog({ projectId: APOLLO })
    const table = await screen.findByRole('table', { name: 'Audit log' })
    expect(within(table).getAllByRole('row')).toHaveLength(PAGE_SIZE + 1)
    fireEvent.click(screen.getByRole('button', { name: 'Show older entries' }))
    expect(await within(table).findByText('Task created')).toBeInTheDocument()
    expect(within(table).getAllByRole('row')).toHaveLength(PAGE_SIZE + 2)
    // The next page starts below the last entry shown.
    expect(requests[1]?.path).toContain(`before=${200 - PAGE_SIZE + 1}`)
    expect(screen.queryByRole('button', { name: 'Show older entries' })).toBeNull()
  })
})

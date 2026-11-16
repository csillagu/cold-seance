import { describe, expect, it } from 'vitest'
import { taskAccess } from './task-access.ts'

const mine = { status: 'not-started' as const, assignees: ['me'] }

describe('taskAccess', () => {
  it('lets the read-write and admin roles change everything, to any status it can move to', () => {
    for (const role of ['read-write', 'admin'] as const) {
      expect(taskAccess(role, 'someone', { status: 'in-progress', assignees: [] })).toEqual({
        edit: true,
        statuses: ['on-hold', 'done', 'cancelled'],
      })
      expect(taskAccess(role, 'someone', { status: 'cancelled', assignees: [] })).toEqual({
        edit: true,
        statuses: [],
      })
    }
  })

  it('lets a contributor only mark a task they are assigned to in progress, on hold or done', () => {
    expect(taskAccess('contributor', 'me', mine)).toEqual({
      edit: false,
      statuses: ['in-progress', 'on-hold', 'done'],
    })
    expect(taskAccess('contributor', 'me', { status: 'on-hold', assignees: ['me'] })).toEqual({
      edit: false,
      statuses: ['in-progress', 'done'],
    })
  })

  it('offers a contributor nothing on a task they are not assigned to, or a finished one', () => {
    const nothing = { edit: false, statuses: [] }
    expect(taskAccess('contributor', 'other', mine)).toEqual(nothing)
    expect(taskAccess('contributor', undefined, mine)).toEqual(nothing)
    expect(taskAccess('contributor', 'me', { status: 'done', assignees: ['me'] })).toEqual(nothing)
  })

  it('offers the read-only role nothing, even on a task they are assigned to', () => {
    expect(taskAccess('read-only', 'me', mine)).toEqual({ edit: false, statuses: [] })
  })
})

import { describe, expect, it } from 'vitest'
import { TASK_STATUSES } from '../db/schema.ts'
import { mayBeConstrained } from './task-status-constraints.ts'

// Which moves take the relations lock before the task's row. The checks themselves read the
// task's subtasks and blockers, and are tested against the database in
// test/integration/task-status-constraints.test.ts.

describe('mayBeConstrained', () => {
  it('answers yes for finishing a task and for setting it in progress', () => {
    expect(mayBeConstrained('done')).toBe(true)
    expect(mayBeConstrained('in-progress')).toBe(true)
  })

  it('answers no for every other status', () => {
    const others = TASK_STATUSES.filter((status) => status !== 'done' && status !== 'in-progress')
    expect(others).toHaveLength(TASK_STATUSES.length - 2)
    for (const status of others) expect(mayBeConstrained(status)).toBe(false)
  })
})

import { describe, expect, it } from 'vitest'
import { ServiceError } from './errors.ts'
import {
  AI_ONLY_SHARE,
  assignmentLoad,
  keptLoadOverrides,
  sorted,
  taskPersonLoad,
  validAiOnlyLoad,
  validLoadOverrides,
} from './person-load.ts'

// The person-load percentage rules (SC-039) on their own. How they hold for tasks stored through
// the task service, and the test cases through the REST API, are in
// test/integration/person-load.test.ts.

const A = '6f1c2a5e-0000-4000-8000-00000000000a'
const B = '6f1c2a5e-0000-4000-8000-00000000000b'
const C = '6f1c2a5e-0000-4000-8000-00000000000c'

function invalid(run: () => unknown): string {
  try {
    run()
  } catch (error) {
    if (error instanceof ServiceError && error.kind === 'invalid') return error.message
    throw error
  }
  throw new Error('expected the value to be refused as invalid')
}

describe('taskPersonLoad (FR-032, FR-149)', () => {
  const load = (aiShare: number | null, aiOnlyLoad: number | null = null, milestone = false) =>
    taskPersonLoad({ aiShare, aiOnlyLoad, milestone })

  it('is 100% minus the AI share', () => {
    expect(load(0)).toBe(100)
    expect(load(50)).toBe(50)
    expect(load(12.5)).toBe(87.5)
    expect(load(99)).toBe(1)
  })

  it('is 100% for a task with no AI share given: a normal task', () => {
    expect(load(null)).toBe(100)
  })

  it('is the percentage an AI-only task was given, and the default, 0%, while it has none', () => {
    expect(AI_ONLY_SHARE).toBe(100)
    expect(load(100)).toBe(0)
    expect(load(100, 1)).toBe(1)
    expect(load(100, 0)).toBe(0)
    expect(load(100, 0.5)).toBe(0.5)
    expect(load(100, 150)).toBe(150)
  })

  it('ignores a given percentage on a task that is not AI-only', () => {
    expect(load(50, 7)).toBe(50)
  })

  it('is null for a milestone, which takes no time (FR-191)', () => {
    expect(load(null, null, true)).toBeNull()
  })
})

describe('assignmentLoad (FR-033)', () => {
  const task = { personLoad: 100, assignees: [A, B], loadOverrides: { [A]: 30 } }

  it("is the assignment's override for its person, the task's own for everyone else", () => {
    expect(assignmentLoad(task, A)).toBe(30)
    expect(assignmentLoad(task, B)).toBe(100)
  })

  it('keeps an override of 0%', () => {
    expect(assignmentLoad({ ...task, loadOverrides: { [A]: 0 } }, A)).toBe(0)
  })

  it('is null for someone not assigned, and for a milestone', () => {
    expect(assignmentLoad(task, C)).toBeNull()
    expect(assignmentLoad({ personLoad: null, assignees: [], loadOverrides: {} }, A)).toBeNull()
  })
})

describe('validAiOnlyLoad (FR-149, FR-032)', () => {
  it('takes any percentage of zero or more for an AI-only task, unrounded', () => {
    for (const value of [0, 0.5, 1, 0.001, 100, 150, 1e6]) {
      expect(validAiOnlyLoad(value, 100)).toBe(value)
    }
  })

  it('takes null for any task, putting it back to the default', () => {
    expect(validAiOnlyLoad(null, 100)).toBeNull()
    expect(validAiOnlyLoad(null, 50)).toBeNull()
    expect(validAiOnlyLoad(null, null)).toBeNull()
  })

  it('refuses a percentage for a task that is not AI-only', () => {
    for (const aiShare of [0, 50, 99.9, null]) {
      expect(invalid(() => validAiOnlyLoad(1, aiShare))).toMatch(/only for an AI-only task/)
    }
  })

  it('refuses anything but a finite number of zero or more', () => {
    for (const value of [-1, -0.5, Number.NaN, Number.POSITIVE_INFINITY, '1', true, {}, []]) {
      expect(invalid(() => validAiOnlyLoad(value, 100))).toBe(
        "A task's person-load percentage is a percentage of zero or more",
      )
    }
  })
})

describe('validLoadOverrides (FR-033)', () => {
  it('takes a percentage of zero or more per assignee, any fraction or above 100%', () => {
    expect(validLoadOverrides({ [A]: 30, [B]: 0.5 }, [A, B])).toEqual({ [A]: 30, [B]: 0.5 })
    expect(validLoadOverrides({ [A]: 0 }, [A])).toEqual({ [A]: 0 })
    expect(validLoadOverrides({ [A]: 150 }, [A])).toEqual({ [A]: 150 })
  })

  it('takes an empty object for none', () => {
    expect(validLoadOverrides({}, [A])).toEqual({})
    expect(validLoadOverrides({}, [])).toEqual({})
  })

  it('puts ids in lower case and the entries in the order of their ids', () => {
    const overrides = validLoadOverrides({ [B]: 1, [A.toUpperCase()]: 2 }, [B, A])
    expect(Object.keys(overrides)).toEqual([A, B])
    expect(overrides).toEqual({ [A]: 2, [B]: 1 })
  })

  it('refuses an override for someone not assigned to the task', () => {
    expect(invalid(() => validLoadOverrides({ [C]: 30 }, [A, B]))).toBe(
      `The person ${C} is not assigned to the task, so their load cannot be overridden`,
    )
  })

  it('refuses one person given twice, in different cases', () => {
    expect(invalid(() => validLoadOverrides({ [A]: 1, [A.toUpperCase()]: 2 }, [A]))).toBe(
      'A person-load override is given once per assignee',
    )
  })

  it('refuses a key that is not an account id', () => {
    expect(invalid(() => validLoadOverrides({ alice: 30 }, [A]))).toBe(
      'A person is named by their account id',
    )
  })

  it('refuses a percentage that is not a finite number of zero or more', () => {
    for (const value of [-1, Number.NaN, '30', null, true]) {
      expect(invalid(() => validLoadOverrides({ [A]: value }, [A]))).toBe(
        'A person-load override is a percentage of zero or more',
      )
    }
  })

  it('refuses anything but an object', () => {
    for (const value of [null, [], [A], 30, A]) {
      expect(invalid(() => validLoadOverrides(value, [A]))).toMatch(/^The person-load overrides/)
    }
  })
})

describe('keptLoadOverrides', () => {
  it('keeps the overrides of those still assigned and drops the rest', () => {
    expect(keptLoadOverrides({ [A]: 30, [B]: 40 }, [B, C])).toEqual({ [B]: 40 })
    expect(keptLoadOverrides({ [A]: 30 }, [])).toEqual({})
  })
})

describe('sorted', () => {
  it('orders the entries by id', () => {
    expect(Object.keys(sorted({ [C]: 1, [A]: 2, [B]: 3 }))).toEqual([A, B, C])
  })
})

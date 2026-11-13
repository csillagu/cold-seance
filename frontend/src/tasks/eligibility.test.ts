import { describe, expect, it } from 'vitest'
import {
  describeExpression,
  draftOf,
  draftProblem,
  type Eligibility,
  expressionOf,
  sameExpression,
} from './eligibility.ts'

const name = (id: string) => id

describe('the eligibility draft', () => {
  it('is empty for no expression, and builds none', () => {
    expect(draftOf(null)).toEqual({ operator: 'any', items: [] })
    expect(expressionOf({ operator: 'all', items: [] })).toBeNull()
  })

  it('round-trips both two-level nesting orders as given (TC-038)', () => {
    const t1: Eligibility = { all: ['alice', { any: ['bob', 'carol', 'dave'] }] }
    const t2: Eligibility = { any: [{ all: ['alice', 'bob'] }, 'carol'] }
    expect(expressionOf(draftOf(t1))).toEqual(t1)
    expect(expressionOf(draftOf(t2))).toEqual(t2)
    expect(draftOf(t1)).toEqual({
      operator: 'all',
      items: ['alice', { operator: 'any', people: ['bob', 'carol', 'dave'] }],
    })
  })

  it('shows a lone person as the one item of an OR', () => {
    expect(draftOf('alice')).toEqual({ operator: 'any', items: ['alice'] })
  })

  it('does not copy the arrays it is given, so editing the draft leaves the expression alone', () => {
    const stored: Eligibility = { all: ['alice', { any: ['bob'] }] }
    const draft = draftOf(stored)
    const inner = draft.items[1]
    if (inner === undefined || typeof inner === 'string') throw new Error('expected a group')
    inner.people.push('carol')
    expect(stored).toEqual({ all: ['alice', { any: ['bob'] }] })
  })

  it('cannot be saved with an empty group', () => {
    expect(draftProblem({ operator: 'all', items: ['a', { operator: 'any', people: [] }] })).toBe(
      'Each group needs at least one person.',
    )
    expect(draftProblem({ operator: 'all', items: ['a'] })).toBeNull()
  })
})

describe('the expression in words', () => {
  it('reads as the TC writes it', () => {
    expect(describeExpression({ all: ['alice', { any: ['bob', 'carol', 'dave'] }] }, name)).toBe(
      'alice AND (bob OR carol OR dave)',
    )
    expect(describeExpression({ any: [{ all: ['alice', 'bob'] }, 'carol'] }, name)).toBe(
      '(alice AND bob) OR carol',
    )
    expect(describeExpression('alice', name)).toBe('alice')
    expect(describeExpression(null, name)).toBe('No one')
    expect(describeExpression({ any: ['a', { all: ['b'] }] }, name)).toBe('a OR b')
  })
})

describe('comparing expressions', () => {
  it('tells a change of grouping from none', () => {
    expect(sameExpression({ all: ['a', 'b'] }, { all: ['a', 'b'] })).toBe(true)
    expect(sameExpression({ all: ['a', 'b'] }, { any: ['a', 'b'] })).toBe(false)
    expect(sameExpression(null, null)).toBe(true)
  })
})

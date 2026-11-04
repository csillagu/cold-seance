import { describe, expect, it } from 'vitest'
import { peopleOf, validAssignees, validEligibility } from './assignment.ts'
import { ServiceError } from './errors.ts'

// The checks of the eligibility and assignment module (SC-005) that need no database. Whether a
// person can read the project (FR-031) is tested against the database in
// test/integration/assignment.test.ts.

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

describe('validEligibility (FR-028, DD-038)', () => {
  it('takes no expression, a person, an AND and an OR of people', () => {
    expect(validEligibility(null)).toBeNull()
    expect(validEligibility(A)).toBe(A)
    expect(validEligibility({ all: [A, B] })).toEqual({ all: [A, B] })
    expect(validEligibility({ any: [A] })).toEqual({ any: [A] })
  })

  it('takes two levels in either nesting, as given', () => {
    expect(validEligibility({ all: [A, { any: [B, C] }] })).toEqual({ all: [A, { any: [B, C] }] })
    expect(validEligibility({ any: [{ all: [A, B] }, C] })).toEqual({ any: [{ all: [A, B] }, C] })
    expect(validEligibility({ any: [{ any: [A] }, { all: [B, C] }] })).toEqual({
      any: [{ any: [A] }, { all: [B, C] }],
    })
  })

  it('puts ids in lower case', () => {
    expect(validEligibility({ any: [A.toUpperCase(), { all: [B.toUpperCase()] }] })).toEqual({
      any: [A, { all: [B] }],
    })
  })

  it('refuses three levels', () => {
    expect(invalid(() => validEligibility({ all: [{ any: [{ all: [A] }] }] }))).toMatch(
      /at most two levels deep/,
    )
  })

  it('refuses a malformed operator one level down as malformed, not as too deep', () => {
    expect(invalid(() => validEligibility({ all: [{ any: [{ not: [A] }] }] }))).toMatch(
      /\{"all": \[\.\.\.\]\} or \{"any": \[\.\.\.\]\}/,
    )
  })

  it('refuses anything that is not a person, an AND or an OR', () => {
    expect(invalid(() => validEligibility(5))).toMatch(/is a person, by account id, or an AND/)
    expect(invalid(() => validEligibility([A]))).toMatch(/is a person, by account id, or an AND/)
    expect(invalid(() => validEligibility({ all: [A, [B]] }))).toMatch(/is a person/)
    expect(invalid(() => validEligibility({}))).toMatch(/\{"all": \[\.\.\.\]\}/)
    expect(invalid(() => validEligibility({ or: [A] }))).toMatch(/\{"all": \[\.\.\.\]\}/)
    expect(invalid(() => validEligibility({ all: [A], any: [B] }))).toMatch(/\{"all"/)
    expect(invalid(() => validEligibility({ all: [] }))).toMatch(/at least one operand/)
    expect(invalid(() => validEligibility({ any: A }))).toMatch(/at least one operand/)
    expect(invalid(() => validEligibility({ all: [A, { any: [] }] }))).toMatch(/at least one/)
  })

  it('refuses a person not named by an account id', () => {
    for (const value of ['alice', '', { any: [A, 'bob'] }, { all: [{ any: [B, 'carol'] }] }]) {
      expect(invalid(() => validEligibility(value))).toBe('A person is named by their account id')
    }
  })
})

describe('validAssignees (FR-029)', () => {
  it('takes a list of people in its order, and an empty list', () => {
    expect(validAssignees([B, A])).toEqual([B, A])
    expect(validAssignees([])).toEqual([])
    expect(validAssignees([A.toUpperCase()])).toEqual([A])
  })

  it('refuses a person twice, even in another case', () => {
    expect(invalid(() => validAssignees([A, B, A]))).toMatch(/only once/)
    expect(invalid(() => validAssignees([A, A.toUpperCase()]))).toMatch(/only once/)
  })

  it('refuses what is not a list of account ids', () => {
    expect(invalid(() => validAssignees(A))).toMatch(/a list of people/)
    expect(invalid(() => validAssignees(null))).toMatch(/a list of people/)
    expect(invalid(() => validAssignees({ 0: A }))).toMatch(/a list of people/)
    expect(invalid(() => validAssignees(['alice']))).toBe('A person is named by their account id')
  })
})

describe('peopleOf', () => {
  it('names each person of an expression once, in order', () => {
    expect(peopleOf(null)).toEqual([])
    expect(peopleOf(A)).toEqual([A])
    expect(peopleOf({ any: [{ all: [B, A] }, A, C] })).toEqual([B, A, C])
  })
})

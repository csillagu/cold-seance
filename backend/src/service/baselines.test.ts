import { describe, expect, it } from 'vitest'
import {
  BASELINE_NAME_MAX_LENGTH,
  baselineName,
  type PlannedDates,
  snapshotOf,
} from './baselines.ts'
import { ServiceError } from './errors.ts'

// The rules of the baseline snapshots that need no database (SC-009); saving, listing and reading
// baselines, and who may, are tested against PostgreSQL in test/integration/baselines.test.ts.

const task = (dates: Partial<PlannedDates>): PlannedDates => ({
  plannedStart: null,
  plannedFinish: null,
  milestoneVariant: null,
  milestoneDate: null,
  floatingDate: null,
  ...dates,
})

describe('snapshotOf', () => {
  it("keeps a task's planned start and finish", () => {
    expect(snapshotOf(task({ plannedStart: '2027-03-01', plannedFinish: '2027-03-03' }))).toEqual({
      plannedStart: '2027-03-01',
      plannedFinish: '2027-03-03',
    })
  })

  it('keeps no dates for a task that has none', () => {
    expect(snapshotOf(task({}))).toEqual({ plannedStart: null, plannedFinish: null })
  })

  it("keeps a fixed-date milestone's date as both its start and finish", () => {
    expect(
      snapshotOf(task({ milestoneVariant: 'fixed-date', milestoneDate: '2027-03-12' })),
    ).toEqual({ plannedStart: '2027-03-12', plannedFinish: '2027-03-12' })
  })

  it('keeps the day the scheduler placed a floating milestone on as both', () => {
    expect(snapshotOf(task({ milestoneVariant: 'floating', floatingDate: '2027-03-04' }))).toEqual({
      plannedStart: '2027-03-04',
      plannedFinish: '2027-03-04',
    })
  })

  it('keeps no dates for a floating milestone that has no day yet', () => {
    expect(snapshotOf(task({ milestoneVariant: 'floating' }))).toEqual({
      plannedStart: null,
      plannedFinish: null,
    })
  })
})

describe('baselineName', () => {
  const refusal = (name: string) => {
    try {
      baselineName(name)
    } catch (error) {
      if (error instanceof ServiceError) return { kind: error.kind, message: error.message }
      throw error
    }
    throw new Error(`${name} was not refused`)
  }

  it('trims the name and puts it in one Unicode form', () => {
    expect(baselineName('  v1 approved\t')).toBe('v1 approved')
    expect(baselineName('Café')).toBe('Café')
  })

  it('refuses an empty name, or one of only spaces', () => {
    expect(refusal('')).toEqual({ kind: 'invalid', message: 'A baseline name is required' })
    expect(refusal('   ')).toEqual({ kind: 'invalid', message: 'A baseline name is required' })
  })

  it('takes a name of 200 characters, counting an emoji as one, and refuses a longer one', () => {
    expect(BASELINE_NAME_MAX_LENGTH).toBe(200)
    expect(baselineName('🚀'.repeat(200))).toBe('🚀'.repeat(200))
    expect(refusal('x'.repeat(201))).toEqual({
      kind: 'invalid',
      message: 'A baseline name can have at most 200 characters',
    })
  })
})

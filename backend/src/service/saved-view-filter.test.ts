import { describe, expect, it } from 'vitest'
import { ServiceError } from './errors.ts'
import {
  FILTER_FIELDS,
  type FilterCondition,
  MAX_FILTER_CONDITIONS,
  MAX_FILTER_TEXT_LENGTH,
  matchesFilter,
  parseFilter,
} from './saved-view-filter.ts'
import type { Task } from './tasks.ts'

const ALICE = '6f1c2a5e-0000-4000-8000-00000000000a'
const BOB = '6f1c2a5e-0000-4000-8000-00000000000b'
const APOLLO = '6f1c2a5e-0000-4000-8000-0000000000c1'
const REPO = '6f1c2a5e-0000-4000-8000-0000000000e1'

const base: Task = {
  id: '6f1c2a5e-0000-4000-8000-0000000000f1',
  projectId: APOLLO,
  title: 'T1',
  description: 'alpha',
  status: 'in-progress',
  plannedStart: '2027-03-01',
  plannedFinish: '2027-03-02',
  durationWorkingDays: 2,
  effort: 3,
  aiShare: 0,
  personLoad: 100,
  milestone: null,
  eligibility: { any: [ALICE, { all: [BOB, ALICE] }] },
  assignees: [ALICE],
  loadOverrides: {},
  withoutReadAccess: [],
  actualStart: '2027-03-01',
  actualFinish: null,
  repositoryId: REPO,
  githubIssue: { repositoryId: REPO, number: 7 },
}

function refusal(input: unknown): string {
  let error: unknown
  try {
    parseFilter(input)
  } catch (thrown) {
    error = thrown
  }
  if (!(error instanceof ServiceError)) throw new Error('expected the filter to be refused')
  expect(error.kind).toBe('invalid')
  return error.message
}

const shows = (filter: FilterCondition[], task: Task = base, viewer = ALICE) =>
  matchesFilter(task, parseFilter(filter), viewer)

describe('parseFilter', () => {
  it('takes no filter, or an empty one, as showing every task', () => {
    expect(parseFilter(undefined)).toEqual([])
    expect(parseFilter(null)).toEqual([])
    expect(parseFilter([])).toEqual([])
  })

  it('keeps a condition on each field as given', () => {
    const filter = [
      { field: 'title', operator: 'contains', value: 'T' },
      { field: 'status', operator: 'is', value: 'in-progress' },
      { field: 'plannedStart', operator: 'at-least', value: '2027-03-01' },
      { field: 'effort', operator: 'at-most', value: 3.5 },
      { field: 'assignees', operator: 'contains', value: { viewer: true } },
      { field: 'eligibility', operator: 'contains', value: { accountId: BOB } },
      { field: 'project', operator: 'is', value: APOLLO },
      { field: 'repository', operator: 'is', value: null },
      { field: 'githubIssue', operator: 'is-not', value: 7 },
      { field: 'milestone', operator: 'is', value: 'floating' },
    ]
    expect(parseFilter(filter)).toEqual(filter)
  })

  it('refuses what is not a list of conditions', () => {
    expect(refusal({})).toMatch(/list of conditions/)
    expect(refusal(['title'])).toMatch(/Condition 1 .* must be an object/)
    expect(refusal([{ field: 'title', operator: 'is', value: 'x', extra: 1 }])).toMatch(
      /only a field, an operator and a value/,
    )
    expect(refusal(Array.from({ length: MAX_FILTER_CONDITIONS + 1 }, () => ({})))).toMatch(
      /at most 50 conditions/,
    )
  })

  it('refuses a field that is not a task field, and an operator the field does not take', () => {
    expect(refusal([{ field: 'colour', operator: 'is', value: 'red' }])).toMatch(/names a field/)
    expect(refusal([{ field: 'toString', operator: 'is', value: 'x' }])).toMatch(/names a field/)
    expect(refusal([{ field: 'status', operator: 'contains', value: 'done' }])).toMatch(
      /status can be compared only by is, is-not/,
    )
    expect(refusal([{ field: 'assignees', operator: 'is', value: { viewer: true } }])).toMatch(
      /only by contains/,
    )
  })

  it("refuses a value not of the field's kind", () => {
    const bad: [string, string, unknown][] = [
      ['title', 'is', 3],
      ['title', 'is', null],
      ['title', 'contains', 'x'.repeat(MAX_FILTER_TEXT_LENGTH + 1)],
      ['status', 'is', 'started'],
      ['status', 'is', null],
      ['plannedStart', 'is', '2027-02-30'],
      ['plannedStart', 'at-most', null],
      ['effort', 'is', '3'],
      ['effort', 'at-least', Number.POSITIVE_INFINITY],
      ['githubIssue', 'is', 0],
      ['githubIssue', 'is', 1.5],
      ['project', 'is', 'Apollo'],
      ['milestone', 'is', 'fixed'],
      ['assignees', 'contains', ALICE],
      ['assignees', 'contains', { viewer: false }],
      ['assignees', 'contains', { accountId: 'alice' }],
      ['assignees', 'contains', { accountId: ALICE, viewer: true }],
    ]
    for (const [field, operator, value] of bad) {
      expect(refusal([{ field, operator, value }])).toMatch(/Condition 1/)
    }
  })
})

describe('matchesFilter', () => {
  it('shows a task that meets every condition, and none that misses one', () => {
    const filter: FilterCondition[] = [
      { field: 'title', operator: 'is', value: 'T1' },
      { field: 'status', operator: 'is', value: 'in-progress' },
    ]
    expect(shows(filter)).toBe(true)
    expect(shows([...filter, { field: 'effort', operator: 'is', value: 8 }])).toBe(false)
    expect(shows([])).toBe(true)
  })

  it('compares text exactly with is, and ignoring case with contains', () => {
    expect(shows([{ field: 'description', operator: 'is', value: 'alpha' }])).toBe(true)
    expect(shows([{ field: 'description', operator: 'is', value: 'Alpha' }])).toBe(false)
    expect(shows([{ field: 'description', operator: 'contains', value: 'LPH' }])).toBe(true)
    expect(shows([{ field: 'description', operator: 'is-not', value: 'beta' }])).toBe(true)
  })

  it('compares dates and numbers by at-most and at-least, never matching an empty field', () => {
    expect(shows([{ field: 'plannedFinish', operator: 'at-most', value: '2027-03-02' }])).toBe(true)
    expect(shows([{ field: 'plannedFinish', operator: 'at-least', value: '2027-03-03' }])).toBe(
      false,
    )
    expect(shows([{ field: 'aiShare', operator: 'at-most', value: 0 }])).toBe(true)
    expect(shows([{ field: 'durationWorkingDays', operator: 'at-least', value: 3 }])).toBe(false)
    expect(shows([{ field: 'actualFinish', operator: 'at-most', value: '2099-01-01' }])).toBe(false)
    expect(shows([{ field: 'actualFinish', operator: 'is', value: null }])).toBe(true)
    expect(shows([{ field: 'actualStart', operator: 'is-not', value: null }])).toBe(true)
  })

  it('finds a person anywhere in the eligibility, and among the assignees', () => {
    expect(shows([{ field: 'eligibility', operator: 'contains', value: { accountId: BOB } }])).toBe(
      true,
    )
    expect(shows([{ field: 'assignees', operator: 'contains', value: { accountId: BOB } }])).toBe(
      false,
    )
    expect(
      shows([{ field: 'eligibility', operator: 'contains', value: { viewer: true } }], {
        ...base,
        eligibility: null,
      }),
    ).toBe(false)
  })

  it('compares with whoever views the task for a condition on the person viewing (FR-058)', () => {
    const mine: FilterCondition[] = [
      { field: 'assignees', operator: 'contains', value: { viewer: true } },
    ]
    expect(shows(mine, base, ALICE)).toBe(true)
    expect(shows(mine, base, BOB)).toBe(false)
    expect(shows(mine, { ...base, assignees: [BOB] }, BOB)).toBe(true)
  })

  it('reads the project, repository, issue and milestone variant of the task', () => {
    expect(shows([{ field: 'project', operator: 'is', value: APOLLO }])).toBe(true)
    expect(shows([{ field: 'repository', operator: 'is', value: REPO }])).toBe(true)
    expect(shows([{ field: 'githubIssue', operator: 'is', value: 7 }])).toBe(true)
    expect(
      shows([{ field: 'githubIssue', operator: 'is', value: null }], {
        ...base,
        githubIssue: null,
      }),
    ).toBe(true)
    expect(shows([{ field: 'milestone', operator: 'is', value: null }])).toBe(true)
    expect(
      shows([{ field: 'milestone', operator: 'is', value: 'fixed-date' }], {
        ...base,
        milestone: { variant: 'fixed-date', date: '2027-03-05' },
      }),
    ).toBe(true)
  })

  it('names every field a task is created or edited with', () => {
    for (const field of [
      'title',
      'description',
      'plannedStart',
      'plannedFinish',
      'durationWorkingDays',
      'effort',
      'aiShare',
      'milestone',
      'eligibility',
      'assignees',
    ]) {
      expect(FILTER_FIELDS).toContain(field)
    }
  })
})

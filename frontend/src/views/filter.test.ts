import { describe, expect, it } from 'vitest'
import {
  comparisonsOf,
  describeCondition,
  FIELDS,
  newCondition,
  problemOf,
  toCondition,
  VIEWER,
  withField,
} from './filter.ts'

const ALICE = '00000000-0000-4000-8000-0000000000a1'
const APOLLO = '00000000-0000-4000-8000-000000000001'

const names = {
  people: new Map([[ALICE, 'alice']]),
  projects: new Map([[APOLLO, 'Apollo']]),
  repositories: new Map<string, string>(),
}

describe('the saved view filter (SC-092)', () => {
  it('offers every task field the REST API filters on (FR-057)', () => {
    expect(FIELDS.map((field) => field.field)).toEqual([
      'title',
      'description',
      'status',
      'plannedStart',
      'plannedFinish',
      'actualStart',
      'actualFinish',
      'durationWorkingDays',
      'effort',
      'aiShare',
      'milestone',
      'eligibility',
      'assignees',
      'project',
      'repository',
      'githubIssue',
    ])
  })

  it('offers only "contains" on the people fields, and no emptiness on the status', () => {
    expect(comparisonsOf('assignees').map((c) => c.value)).toEqual(['contains'])
    expect(comparisonsOf('status').map((c) => c.value)).toEqual(['is', 'is-not'])
  })

  it('starts a people condition on the person viewing, and sends it as the viewer (FR-058)', () => {
    const condition = newCondition('assignees')
    expect(condition.value).toBe(VIEWER)
    expect(toCondition(condition)).toEqual({
      field: 'assignees',
      operator: 'contains',
      value: { viewer: true },
    })
    expect(toCondition({ ...condition, value: ALICE })).toEqual({
      field: 'assignees',
      operator: 'contains',
      value: { accountId: ALICE },
    })
  })

  it('sends numbers as numbers and an empty field as null', () => {
    expect(toCondition({ field: 'effort', comparison: 'is', value: ' 3 ' })).toEqual({
      field: 'effort',
      operator: 'is',
      value: 3,
    })
    expect(toCondition({ field: 'plannedStart', comparison: 'empty', value: '' })).toEqual({
      field: 'plannedStart',
      operator: 'is',
      value: null,
    })
    expect(toCondition({ field: 'milestone', comparison: 'not-empty', value: '' })).toEqual({
      field: 'milestone',
      operator: 'is-not',
      value: null,
    })
  })

  it('names what a condition lacks before it is sent', () => {
    expect(problemOf({ field: 'title', comparison: 'is', value: ' ' })).toBe(
      'Title needs a text to compare with',
    )
    expect(problemOf({ field: 'effort', comparison: 'is', value: 'x' })).toBe(
      'Effort needs a number',
    )
    expect(problemOf({ field: 'githubIssue', comparison: 'is', value: '0' })).toBe(
      'GitHub issue number needs an issue number',
    )
    expect(problemOf({ field: 'plannedStart', comparison: 'empty', value: '' })).toBeNull()
    expect(problemOf({ field: 'status', comparison: 'is', value: 'in-progress' })).toBeNull()
  })

  it('keeps the value when the field changes to one of the same kind only', () => {
    const start = { field: 'plannedStart', comparison: 'at-least', value: '2027-03-01' } as const
    expect(withField(start, 'plannedFinish')).toEqual({ ...start, field: 'plannedFinish' })
    expect(withField(start, 'status')).toEqual({
      field: 'status',
      comparison: 'is',
      value: 'in-progress',
    })
  })

  it('describes a condition in words', () => {
    expect(
      describeCondition({ field: 'status', operator: 'is', value: 'in-progress' }, names),
    ).toBe('Status is In progress')
    expect(
      describeCondition(
        { field: 'assignees', operator: 'contains', value: { viewer: true } },
        names,
      ),
    ).toBe('Assigned people contains the person viewing')
    expect(
      describeCondition(
        { field: 'eligibility', operator: 'contains', value: { accountId: ALICE } },
        names,
      ),
    ).toBe('Eligibility contains alice')
    expect(describeCondition({ field: 'project', operator: 'is-not', value: APOLLO }, names)).toBe(
      'Project is not Apollo',
    )
    expect(describeCondition({ field: 'plannedStart', operator: 'is', value: null }, names)).toBe(
      'Planned start is empty',
    )
  })
})

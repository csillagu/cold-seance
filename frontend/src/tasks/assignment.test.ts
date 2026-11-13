import { describe, expect, it } from 'vitest'
import { assignmentChanges, assignmentDraftOf, percentageOf } from './assignment.ts'

const name = (id: string) => id

describe('the assignment draft', () => {
  it('holds the assignees in order, with the overrides typed out', () => {
    expect(
      assignmentDraftOf({ assignees: ['bob', 'alice'], loadOverrides: { alice: 30 } }),
    ).toEqual({ assignees: ['bob', 'alice'], overrides: { bob: '', alice: '30' } })
  })

  it('changes nothing when nothing was changed', () => {
    const task = { assignees: ['alice'], loadOverrides: { alice: 0.5 } }
    expect(assignmentChanges(task, assignmentDraftOf(task), name)).toEqual({})
  })

  it('sends the new list, and the overrides of those who stay', () => {
    const task = { assignees: ['alice', 'bob'], loadOverrides: { alice: 30 } }
    expect(
      assignmentChanges(task, { assignees: ['alice'], overrides: { alice: '30' } }, name),
    ).toEqual({ assignees: ['alice'] })
    expect(assignmentChanges(task, { assignees: ['bob'], overrides: { bob: '' } }, name)).toEqual({
      assignees: ['bob'],
      loadOverrides: {},
    })
  })

  it("sends an override for one person only, leaving the others on the task's load (TC-045)", () => {
    const task = { assignees: ['alice', 'bob'], loadOverrides: {} }
    expect(
      assignmentChanges(
        task,
        { assignees: ['alice', 'bob'], overrides: { alice: '30', bob: '' } },
        name,
      ),
    ).toEqual({ loadOverrides: { alice: 30 } })
  })

  it('refuses a load that is no number', () => {
    const task = { assignees: ['alice'], loadOverrides: {} }
    expect(
      assignmentChanges(task, { assignees: ['alice'], overrides: { alice: 'lots' } }, name),
    ).toBe('The load of alice is not a number.')
  })
})

describe('a typed percentage', () => {
  it('is null when empty, and taken as typed otherwise', () => {
    expect(percentageOf(' ')).toBeNull()
    expect(percentageOf('0.5')).toBe(0.5)
    expect(percentageOf('150')).toBe(150)
    expect(percentageOf('x')).toBeNaN()
  })
})

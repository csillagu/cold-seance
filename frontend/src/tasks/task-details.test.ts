import { describe, expect, it } from 'vitest'
import {
  type DetailedTask,
  detailsChanges,
  detailsDraftOf,
  detailsProblem,
  newDetailsDraft,
  newTaskFields,
} from './task-details.ts'

const task: DetailedTask = {
  title: 'Draft schema',
  description: 'Tables first',
  plannedStart: '2027-03-04',
  plannedFinish: '2027-03-08',
  durationWorkingDays: 3,
  effort: 5,
  aiShare: 0,
  personLoad: 100,
  milestone: null,
}

describe('the task details editor (SC-098)', () => {
  it('creates a task with its title and only the fields filled in (TC-001)', () => {
    expect(newTaskFields({ ...newDetailsDraft(), title: 'Triage backlog' })).toEqual({
      title: 'Triage backlog',
    })
    expect(
      newTaskFields({
        ...newDetailsDraft(),
        title: 'Write install guide',
        description: 'Steps for a fresh install',
        start: '2027-03-01',
        duration: '3',
        finish: '2027-03-10',
        effort: '5',
        aiShare: '0',
      }),
    ).toEqual({
      title: 'Write install guide',
      description: 'Steps for a fresh install',
      plannedStart: '2027-03-01',
      durationWorkingDays: 3,
      effort: 5,
      aiShare: 0,
    })
  })

  it('sends a finish only for a task with no duration', () => {
    expect(
      newTaskFields({
        ...newDetailsDraft(),
        title: 'T',
        start: '2027-03-01',
        finish: '2027-03-05',
      }),
    ).toEqual({ title: 'T', plannedStart: '2027-03-01', plannedFinish: '2027-03-05' })
  })

  it("offers 1% as a new AI-only task's person load, and sends it (TC-221)", () => {
    const draft = { ...newDetailsDraft(), title: 'T', aiShare: '100' }
    expect(draft.personLoad).toBe('1')
    expect(newTaskFields(draft)).toEqual({ title: 'T', aiShare: 100, personLoad: 1 })
  })

  it('takes durations in whole working days only (TC-002)', () => {
    const draft = { ...newDetailsDraft(), title: 'T' }
    expect(detailsProblem({ ...draft, duration: '3' })).toBeNull()
    for (const duration of ['2.5', '0', '-1', 'x']) {
      expect(detailsProblem({ ...draft, duration })).toBe(
        'The duration is a whole number of working days, 1 or more.',
      )
    }
  })

  it('asks for a title', () => {
    expect(detailsProblem({ ...newDetailsDraft(), title: '  ' })).toBe('The task needs a title.')
  })

  it('changes only what was changed', () => {
    const draft = detailsDraftOf(task)
    expect(detailsChanges(task, draft)).toEqual({})
    expect(detailsChanges(task, { ...draft, title: 'Final' })).toEqual({ title: 'Final' })
    expect(detailsChanges(task, { ...draft, description: '' })).toEqual({ description: '' })
  })

  it('removes every planned date, leaving the task unscheduled (TC-003)', () => {
    expect(
      detailsChanges(task, { ...detailsDraftOf(task), start: '', duration: '', finish: '' }),
    ).toEqual({ plannedStart: null, durationWorkingDays: null, plannedFinish: null })
  })

  it("sends 1% with a task becoming AI-only, not with an AI-only task's other changes", () => {
    expect(detailsChanges(task, { ...detailsDraftOf(task), aiShare: '100' })).toEqual({
      aiShare: 100,
      personLoad: 1,
    })
    const aiOnly = { ...task, aiShare: 100, personLoad: 30 }
    expect(detailsChanges(aiOnly, { ...detailsDraftOf(aiOnly), effort: '8' })).toEqual({
      effort: 8,
    })
  })

  it("changes only a milestone's title and description", () => {
    const milestone = { ...task, milestone: { variant: 'floating', date: null } }
    expect(
      detailsChanges(milestone, { ...detailsDraftOf(milestone), title: 'M', start: '' }),
    ).toEqual({ title: 'M' })
  })
})

import { describe, expect, it } from 'vitest'
import { type AvailabilityTask, unavailableTasks } from './assignee-availability.ts'
import type { Calendars } from './scheduler.ts'

const APOLLO = 'apollo'
const NO_HOLIDAYS: Calendars = {
  weekendDays: ['saturday', 'sunday'],
  holidays: [],
  personalHolidays: new Map(),
}

function task(fields: Partial<AvailabilityTask> = {}): AvailabilityTask {
  // 2027-03-01 is a Monday: three working days run to 2027-03-03.
  return {
    id: 'T',
    projectId: APOLLO,
    plannedStart: '2027-03-01',
    plannedFinish: '2027-03-03',
    durationWorkingDays: 3,
    parent: false,
    assignees: ['alice'],
    ...fields,
  }
}

describe('the assignee availability flag detector (SC-042)', () => {
  it('finds nothing when no assigned person is overloaded or on holiday', () => {
    expect(unavailableTasks([task()], new Map(), NO_HOLIDAYS)).toEqual([])
  })

  it('makes a task red for each day within it on which an assigned person is overloaded (FR-020)', () => {
    const overloaded = new Map([
      ['alice', ['2027-02-26', '2027-03-03', '2027-03-04']],
      ['bob', ['2027-03-01']],
    ])
    expect(
      unavailableTasks([task({ assignees: ['bob', 'alice'] })], overloaded, NO_HOLIDAYS),
    ).toEqual([
      {
        taskId: 'T',
        projectId: APOLLO,
        overloads: [
          { accountId: 'bob', date: '2027-03-01' },
          { accountId: 'alice', date: '2027-03-03' },
        ],
        holiday: false,
      },
    ])
  })

  it('leaves a task red to no one for an overload of someone not assigned to it', () => {
    const overloaded = new Map([['carol', ['2027-03-01']]])
    expect(unavailableTasks([task()], overloaded, NO_HOLIDAYS)).toEqual([])
  })

  it('makes a task red when a holiday of an assigned person takes one of its working days (FR-020)', () => {
    const calendars = { ...NO_HOLIDAYS, personalHolidays: new Map([['alice', ['2027-03-02']]]) }
    expect(unavailableTasks([task()], new Map(), calendars)).toEqual([
      { taskId: 'T', projectId: APOLLO, overloads: [], holiday: true },
    ])
  })

  it('leaves a task scheduled around the holiday as it is', () => {
    const calendars = { ...NO_HOLIDAYS, personalHolidays: new Map([['alice', ['2027-03-02']]]) }
    expect(unavailableTasks([task({ plannedFinish: '2027-03-04' })], new Map(), calendars)).toEqual(
      [],
    )
  })

  it('takes no account of the holiday of someone not assigned to the task', () => {
    const calendars = { ...NO_HOLIDAYS, personalHolidays: new Map([['bob', ['2027-03-02']]]) }
    expect(unavailableTasks([task()], new Map(), calendars)).toEqual([])
  })

  it('counts a company holiday that takes one of its working days too', () => {
    const calendars = { ...NO_HOLIDAYS, holidays: ['2027-03-02'] }
    expect(unavailableTasks([task()], new Map(), calendars)).toEqual([
      { taskId: 'T', projectId: APOLLO, overloads: [], holiday: true },
    ])
  })

  it('does not check a parent, a task with no duration, or one with nobody assigned, for holidays', () => {
    const calendars = { ...NO_HOLIDAYS, holidays: ['2027-03-02'] }
    expect(
      unavailableTasks(
        [
          task({ id: 'parent', parent: true }),
          task({ id: 'no-duration', durationWorkingDays: null }),
          task({ id: 'nobody', assignees: [] }),
        ],
        new Map(),
        calendars,
      ),
    ).toEqual([])
  })
})

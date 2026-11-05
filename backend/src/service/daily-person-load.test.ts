import { describe, expect, it } from 'vitest'
import {
  type AssignedTask,
  dailyLoads,
  type LoadInputs,
  MAX_LOAD_DAYS,
  validSpan,
} from './daily-person-load.ts'
import { ServiceError } from './errors.ts'

// The aggregation itself, without a database: the rules of SC-006 over given tasks, calendars and
// absences. The reads and the permission checks are tested in test/integration.

const ALICE = 'a0000000-0000-4000-8000-000000000001'
const BOB = 'b0000000-0000-4000-8000-000000000002'
const APOLLO = 'p0000000-0000-4000-8000-000000000001'
const BOREALIS = 'p0000000-0000-4000-8000-000000000002'

const task = (fields: Partial<AssignedTask> = {}): AssignedTask => ({
  id: 't1',
  projectId: APOLLO,
  title: 'T',
  plannedStart: '2027-03-01',
  plannedFinish: '2027-03-05',
  load: 60,
  assignees: [ALICE],
  ...fields,
})

const inputs = (fields: Partial<LoadInputs> = {}): LoadInputs => ({
  tasks: [],
  calendars: { weekendDays: ['saturday', 'sunday'], holidays: [], personalHolidays: new Map() },
  absences: [],
  capacity: 100,
  readable: new Set([APOLLO, BOREALIS]),
  ...fields,
})

const loads = (days: { date: string; load: number }[]) =>
  Object.fromEntries(days.map((day) => [day.date, day.load]))

describe('dailyLoads', () => {
  it('gives one entry for each day of the span, in order, with no load when there is no task', () => {
    const days = dailyLoads('2027-02-27', '2027-03-02', inputs())
    expect(days).toEqual([
      {
        date: '2027-02-27',
        load: 0,
        tasks: [],
        otherProjects: 0,
        capacity: 100,
        overloaded: false,
      },
      {
        date: '2027-02-28',
        load: 0,
        tasks: [],
        otherProjects: 0,
        capacity: 100,
        overloaded: false,
      },
      {
        date: '2027-03-01',
        load: 0,
        tasks: [],
        otherProjects: 0,
        capacity: 100,
        overloaded: false,
      },
      {
        date: '2027-03-02',
        load: 0,
        tasks: [],
        otherProjects: 0,
        capacity: 100,
        overloaded: false,
      },
    ])
  })

  it("puts the task's whole percentage on every working day from its start to its finish (FR-034)", () => {
    const days = dailyLoads('2027-02-26', '2027-03-08', inputs({ tasks: [task()] }))
    expect(loads(days)).toEqual({
      '2027-02-26': 0,
      '2027-02-27': 0,
      '2027-02-28': 0,
      '2027-03-01': 60,
      '2027-03-02': 60,
      '2027-03-03': 60,
      '2027-03-04': 60,
      '2027-03-05': 60,
      '2027-03-06': 0,
      '2027-03-07': 0,
      '2027-03-08': 0,
    })
  })

  it("puts no load on the task's forbidden dates inside it: weekend, company and personal holidays", () => {
    const spanning = task({
      plannedStart: '2027-03-04',
      plannedFinish: '2027-03-10',
      assignees: [ALICE, BOB],
    })
    const days = dailyLoads(
      '2027-03-04',
      '2027-03-10',
      inputs({
        tasks: [spanning],
        calendars: {
          weekendDays: ['saturday', 'sunday'],
          holidays: ['2027-03-08'],
          // Bob's day off is one of the task's forbidden dates, so Alice carries none of it then.
          personalHolidays: new Map([[BOB, ['2027-03-09']]]),
        },
      }),
    )
    expect(loads(days)).toEqual({
      '2027-03-04': 60,
      '2027-03-05': 60,
      '2027-03-06': 0,
      '2027-03-07': 0,
      '2027-03-08': 0,
      '2027-03-09': 0,
      '2027-03-10': 60,
    })
  })

  it('sums the load of every task active on a day, across projects (FR-036)', () => {
    const days = dailyLoads(
      '2027-03-01',
      '2027-03-02',
      inputs({
        tasks: [
          task({ id: 't1', plannedFinish: '2027-03-01', load: 50 }),
          task({ id: 't2', projectId: BOREALIS, plannedFinish: '2027-03-01', load: 30 }),
        ],
      }),
    )
    expect(loads(days)).toEqual({ '2027-03-01': 80, '2027-03-02': 0 })
  })

  it('gives the tasks of readable projects by name and the rest only as a percentage (FR-046)', () => {
    const [day] = dailyLoads(
      '2027-03-01',
      '2027-03-01',
      inputs({
        tasks: [
          task({ id: 'visible', title: 'Visible task', load: 40 }),
          task({ id: 'hidden', projectId: BOREALIS, title: 'Hidden task', load: 60 }),
          task({ id: 'hidden2', projectId: BOREALIS, title: 'Other hidden', load: 5 }),
        ],
        readable: new Set([APOLLO]),
      }),
    )
    expect(day).toEqual({
      date: '2027-03-01',
      load: 105,
      tasks: [{ taskId: 'visible', projectId: APOLLO, title: 'Visible task', load: 40 }],
      otherProjects: 65,
      capacity: 100,
      overloaded: true,
    })
    expect(JSON.stringify(day)).not.toContain('Hidden')
    expect(JSON.stringify(day)).not.toContain(BOREALIS)
  })

  it('counts only the part of a task inside the span', () => {
    const days = dailyLoads(
      '2027-03-03',
      '2027-03-04',
      inputs({ tasks: [task({ plannedStart: '2027-02-01', plannedFinish: '2027-12-31' })] }),
    )
    expect(loads(days)).toEqual({ '2027-03-03': 60, '2027-03-04': 60 })
  })

  it('counts nothing of a task or an absence wholly outside the span', () => {
    const days = dailyLoads(
      '2027-03-03',
      '2027-03-05',
      inputs({
        tasks: [
          task({ id: 'before', plannedStart: '2027-02-22', plannedFinish: '2027-03-01' }),
          task({ id: 'after', plannedStart: '2027-03-08', plannedFinish: '2027-03-12' }),
        ],
        absences: [
          { from: '2027-02-22', to: '2027-03-01' },
          { from: '2027-03-08', to: '2027-03-09' },
        ],
      }),
    )
    expect(days.map((day) => [day.load, day.capacity])).toEqual([
      [0, 100],
      [0, 100],
      [0, 100],
    ])
  })

  it('sets the capacity to 0 on each day of an absence, inside the span (FR-151)', () => {
    const days = dailyLoads(
      '2027-03-01',
      '2027-03-04',
      inputs({
        capacity: 80,
        absences: [
          { from: '2027-02-20', to: '2027-03-01' },
          { from: '2027-03-03', to: '2027-03-03' },
        ],
      }),
    )
    expect(days.map((day) => day.capacity)).toEqual([0, 80, 0, 80])
  })

  it('gives no capacity, and so no absence, to a viewer who may not read it', () => {
    const days = dailyLoads(
      '2027-03-01',
      '2027-03-02',
      inputs({ capacity: null, absences: [{ from: '2027-03-01', to: '2027-03-01' }] }),
    )
    expect(days.map((day) => day.capacity)).toEqual([null, null])
    expect(days.map((day) => day.overloaded)).toEqual([null, null])
  })

  it('marks overloaded each day whose load is above its capacity, and no other (FR-042, SC-040)', () => {
    const days = dailyLoads(
      '2027-03-01',
      '2027-03-04',
      inputs({
        capacity: 80,
        tasks: [task({ load: 80, plannedStart: '2027-03-01', plannedFinish: '2027-03-03' })],
        absences: [{ from: '2027-03-02', to: '2027-03-02' }],
      }),
    )
    // 80% of 80% is no overload; 80% on an absence day, of capacity 0, is.
    expect(days.map((day) => [day.load, day.capacity, day.overloaded])).toEqual([
      [80, 80, false],
      [80, 0, true],
      [80, 80, false],
      [0, 80, false],
    ])
  })

  it('keeps a load of 0% from a task, and loads above 100%', () => {
    const days = dailyLoads(
      '2027-03-01',
      '2027-03-01',
      inputs({ tasks: [task({ id: 'a', load: 0 }), task({ id: 'b', load: 150 })] }),
    )
    expect(days[0]?.load).toBe(150)
    expect(days[0]?.tasks.map((t) => t.load)).toEqual([0, 150])
  })
})

describe('validSpan', () => {
  const refusal = (span: { from?: unknown; to?: unknown }) => {
    try {
      validSpan(span)
    } catch (error) {
      if (!(error instanceof ServiceError)) throw error
      expect(error.kind).toBe('invalid')
      return error.message
    }
    throw new Error('the span was not refused')
  }

  it('takes two dates, the second not before the first', () => {
    expect(validSpan({ from: '2027-03-01', to: '2027-03-01' })).toEqual({
      from: '2027-03-01',
      to: '2027-03-01',
    })
  })

  it('refuses a missing or malformed date', () => {
    expect(refusal({ from: '2027-03-01' })).toMatch(/each a date/)
    expect(refusal({ to: '2027-03-01' })).toMatch(/each a date/)
    expect(refusal({ from: '2027-02-30', to: '2027-03-01' })).toMatch(/each a date/)
    expect(refusal({ from: 20270301, to: '2027-03-01' })).toMatch(/each a date/)
  })

  it('refuses a last day before the first', () => {
    expect(refusal({ from: '2027-03-02', to: '2027-03-01' })).toMatch(/before the first/)
  })

  it(`takes at most ${MAX_LOAD_DAYS} days`, () => {
    expect(validSpan({ from: '2028-01-01', to: '2028-12-31' })).toBeTruthy()
    expect(refusal({ from: '2027-01-01', to: '2028-01-02' })).toMatch(/at most 366 days/)
  })
})

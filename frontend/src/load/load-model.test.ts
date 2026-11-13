import { describe, expect, it } from 'vitest'
import type { ApiTask } from '../gantt/gantt-model.ts'
import {
  type ApiDayLoad,
  buildRows,
  cellLabel,
  datesInWords,
  daysOf,
  defaultSpan,
  formatPercent,
  noLoadTasks,
  spanOf,
  spanProblem,
  today,
} from './load-model.ts'

const day = (date: string, fields: Partial<ApiDayLoad> = {}): ApiDayLoad => ({
  date,
  load: 0,
  tasks: [],
  otherProjects: 0,
  capacity: 100,
  overloaded: false,
  ...fields,
})

const task = (id: string, fields: Partial<ApiTask> = {}): ApiTask => ({
  id,
  projectId: 'apollo',
  title: id,
  status: 'not-started',
  plannedStart: '2027-03-01',
  plannedFinish: '2027-03-02',
  durationWorkingDays: 2,
  aiShare: null,
  milestone: null,
  assignees: ['alice'],
  ...fields,
})

describe('the span', () => {
  it('is four weeks from the Monday of the week by default', () => {
    // 2027-03-03 is a Wednesday.
    expect(defaultSpan('2027-03-03')).toEqual({ from: '2027-03-01', to: '2027-03-28' })
    expect(defaultSpan('2027-03-01')).toEqual({ from: '2027-03-01', to: '2027-03-28' })
  })

  it('is the one the address asks for, if it is valid', () => {
    const asked = new URLSearchParams('from=2027-03-01&to=2027-03-05')
    expect(spanOf(asked, '2026-11-13')).toEqual({ from: '2027-03-01', to: '2027-03-05' })
    const reversed = new URLSearchParams('from=2027-03-05&to=2027-03-01')
    expect(spanOf(reversed, '2027-03-03')).toEqual(defaultSpan('2027-03-03'))
    expect(spanOf(new URLSearchParams('from=2027-03-01'), '2027-03-03')).toEqual(
      defaultSpan('2027-03-03'),
    )
  })

  it('refuses a span that is not dates, runs backwards, or is longer than the API reads', () => {
    expect(spanProblem({ from: '2027-03-01', to: '2027-03-01' })).toBeNull()
    expect(spanProblem({ from: '', to: '2027-03-01' })).toMatch(/dates/)
    expect(spanProblem({ from: '2027-02-30', to: '2027-03-01' })).toMatch(/dates/)
    expect(spanProblem({ from: '2027-03-02', to: '2027-03-01' })).toMatch(/after/)
    expect(spanProblem({ from: '2027-01-01', to: '2028-01-01' })).toBeNull()
    expect(spanProblem({ from: '2027-01-01', to: '2028-01-02' })).toMatch(/366/)
  })

  it('lists every day from the first to the last', () => {
    expect(daysOf({ from: '2027-02-27', to: '2027-03-02' })).toEqual([
      '2027-02-27',
      '2027-02-28',
      '2027-03-01',
      '2027-03-02',
    ])
  })

  it("takes today's date in the browser's time zone", () => {
    expect(today(new Date(2027, 2, 1, 23, 30))).toBe('2027-03-01')
  })
})

describe('the rows', () => {
  it('has one row per member, by username, with the readable tasks behind the load', () => {
    const t1 = { taskId: 't1', projectId: 'apollo', title: 'T1', load: 50 }
    const t2 = { taskId: 't2', projectId: 'borealis', title: 'T2', load: 20 }
    const rows = buildRows(
      [
        { accountId: 'c', username: 'carol' },
        { accountId: 'a', username: 'alice' },
      ],
      new Map([
        [
          'c',
          {
            accountId: 'c',
            from: '2027-03-01',
            to: '2027-03-02',
            days: [
              day('2027-03-01', { load: 50, tasks: [t1] }),
              day('2027-03-02', { load: 70, tasks: [t1, t2] }),
            ],
          },
        ],
      ]),
    )
    expect(rows.map((row) => row.username)).toEqual(['alice', 'carol'])
    expect(rows[0]!.days).toEqual([])
    expect(rows[1]!.tasks).toEqual([t1, t2])
  })
})

describe('the tasks on no one’s load', () => {
  it('are the unscheduled, cancelled, milestone and unassigned tasks not rated', () => {
    const tasks = [
      task('scheduled'),
      task('unscheduled', { plannedStart: null, plannedFinish: null, durationWorkingDays: null }),
      task('cancelled', { status: 'cancelled' }),
      task('milestone', { milestone: { variant: 'floating', date: '2027-03-02' } }),
      task('dateless milestone', { milestone: { variant: 'floating', date: null } }),
      task('nobody', { assignees: [] }),
      task('rated', { assignees: [] }),
    ]
    expect(
      noLoadTasks(tasks, new Set(['rated'])).map((found) => [found.task.id, found.reason]),
    ).toEqual([
      ['unscheduled', 'unscheduled'],
      ['cancelled', 'cancelled'],
      ['milestone', 'milestone'],
      ['dateless milestone', 'unscheduled'],
      ['nobody', 'unassigned'],
    ])
  })
})

describe('the words', () => {
  it('writes percentages whole or to one decimal', () => {
    expect(formatPercent(80)).toBe('80%')
    expect(formatPercent(12.25)).toBe('12.3%')
    expect(formatPercent(0)).toBe('0%')
  })

  it("says a cell's load, its capacity and whether it is an overload", () => {
    expect(cellLabel('carol', day('2027-03-02', { load: 70, capacity: 80 }))).toBe(
      'carol, 2 Mar 2027: 70% of 80% capacity',
    )
    expect(
      cellLabel('alice', day('2027-03-01', { load: 100, capacity: 80, overloaded: true })),
    ).toBe('alice, 1 Mar 2027: 100% of 80% capacity, overloaded')
    expect(
      cellLabel('bob', day('2027-03-01', { load: 30, capacity: null, overloaded: null })),
    ).toBe('bob, 1 Mar 2027: 30%')
  })

  it("writes a task's planned days", () => {
    expect(datesInWords('2027-03-01', '2027-03-01')).toBe('1 Mar 2027')
    expect(datesInWords('2027-03-01', '2027-03-05')).toBe('1 Mar – 5 Mar 2027')
    expect(datesInWords('2027-12-30', '2028-01-03')).toBe('30 Dec 2027 – 3 Jan 2028')
  })
})

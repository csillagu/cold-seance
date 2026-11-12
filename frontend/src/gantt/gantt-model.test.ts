import { describe, expect, it } from 'vitest'
import {
  addDays,
  type ApiRedFlag,
  type ApiRelations,
  type ApiTask,
  arrowPath,
  buildGanttModel,
  daysBetween,
  formatDay,
  formatMonth,
  weekday,
} from './gantt-model.ts'

const P = 'project-apollo'
const calendar = { weekendDays: ['saturday', 'sunday'], holidays: [] }

function task(id: string, fields: Partial<ApiTask> = {}): ApiTask {
  return {
    id,
    projectId: P,
    title: id,
    status: 'not-started',
    plannedStart: null,
    plannedFinish: null,
    durationWorkingDays: null,
    aiShare: null,
    milestone: null,
    assignees: [],
    ...fields,
  }
}

function relations(
  taskId: string,
  blockedBy: string[] = [],
  parent: string | null = null,
): ApiRelations {
  return {
    taskId,
    parent: parent ? { id: parent, projectId: P } : null,
    blockedBy: blockedBy.map((id) => ({ id, projectId: P })),
  }
}

const ref = (id: string) => ({ id, projectId: P })

// TC-067's plan: A, B blocked by A, and M blocked by B, pinned to 2027-03-12.
const a = task('A', {
  plannedStart: '2027-03-01',
  plannedFinish: '2027-03-03',
  durationWorkingDays: 3,
})
const b = task('B', {
  plannedStart: '2027-03-04',
  plannedFinish: '2027-03-05',
  durationWorkingDays: 2,
})
const m = task('M', { milestone: { variant: 'fixed-date', date: '2027-03-12' } })
const plan = [relations('A'), relations('B', ['A']), relations('M', ['B'])]

describe('the dates the Gantt works with', () => {
  it('counts days, weekdays and writes dates as the design does', () => {
    expect(addDays('2027-02-27', 3)).toBe('2027-03-02')
    expect(daysBetween('2027-03-01', '2027-03-12')).toBe(11)
    expect(daysBetween('2027-03-12', '2027-03-01')).toBe(-11)
    expect(weekday('2027-03-01')).toBe(0)
    expect(weekday('2027-03-07')).toBe(6)
    expect(formatDay('2027-03-09')).toBe('9 Mar')
    expect(formatDay('2027-03-09', true)).toBe('9 Mar 2027')
    expect(formatMonth('2027-03-09')).toBe('March 2027')
  })
})

describe('the Gantt model (SC-031)', () => {
  it('lays out TC-067: the schedule, the dependencies and the milestone, none red', () => {
    const model = buildGanttModel([a, b, m], plan, [], calendar)

    expect(model.rows.map((row) => [row.task.id, row.start, row.finish, row.red])).toEqual([
      ['A', '2027-03-01', '2027-03-03', false],
      ['B', '2027-03-04', '2027-03-05', false],
      ['M', '2027-03-12', '2027-03-12', false],
    ])
    expect(model.dependencies).toEqual([
      { task: 'B', blocker: 'A', red: false },
      { task: 'M', blocker: 'B', red: false },
    ])
    // From the Monday of the first week to the Sunday of the week after the last.
    expect(model.days[0]).toEqual({ date: '2027-03-01', nonWorking: false })
    expect(model.days.at(-1)).toEqual({ date: '2027-03-21', nonWorking: true })
    expect(model.days.filter((day) => day.nonWorking).map((day) => day.date)).toEqual([
      '2027-03-06',
      '2027-03-07',
      '2027-03-13',
      '2027-03-14',
      '2027-03-20',
      '2027-03-21',
    ])
  })

  it('marks the company holidays as days off', () => {
    const model = buildGanttModel([a], [relations('A')], [], {
      weekendDays: ['saturday', 'sunday'],
      holidays: ['2027-03-02'],
    })
    expect(model.days.find((day) => day.date === '2027-03-02')?.nonWorking).toBe(true)
  })

  it('shows a pushed fixed-date milestone and its dependency on the work that pushes it in red (FR-013)', () => {
    const late = { ...a, plannedFinish: '2027-03-19', durationWorkingDays: 15 }
    const flags: ApiRedFlag[] = [
      {
        kind: 'fixed-date-milestone-pushed',
        task: ref('M'),
        blocker: ref('A'),
        blockerFinish: '2027-03-19',
      },
    ]
    const model = buildGanttModel(
      [late, m],
      [relations('A'), relations('M', ['A'])],
      flags,
      calendar,
    )

    const milestone = model.rows.find((row) => row.task.id === 'M')
    expect(milestone).toMatchObject({
      start: '2027-03-12',
      red: true,
      note: 'Fixed 12 Mar · pushed: blocker ends 19 Mar',
    })
    expect(model.rows.find((row) => row.task.id === 'A')?.red).toBe(false)
    expect(model.dependencies).toEqual([{ task: 'M', blocker: 'A', red: true }])
  })

  it('shows a task in red whose assigned people cannot do it in its time (FR-020)', () => {
    const flags: ApiRedFlag[] = [
      { kind: 'overload' },
      { kind: 'assignee-unavailable', task: ref('A') },
    ]
    const model = buildGanttModel([a, b], [relations('A'), relations('B')], flags, calendar)
    expect(model.rows.map((row) => [row.task.id, row.red, row.note])).toEqual([
      ['A', true, null],
      ['B', false, null],
    ])
  })

  it("shows a task in red that starts before another project's milestone it depends on", () => {
    const flags: ApiRedFlag[] = [
      {
        kind: 'cross-project-dependency',
        task: ref('B'),
        blocker: { id: 'other', projectId: 'project-borealis' },
        blockerFinish: '2027-03-10',
      },
    ]
    const model = buildGanttModel(
      [b],
      [{ taskId: 'B', parent: null, blockedBy: [{ id: 'other', projectId: 'project-borealis' }] }],
      flags,
      calendar,
    )
    expect(model.rows[0]?.red).toBe(true)
    // The line to the other project's milestone is the cross-project lines' (SC-066).
    expect(model.dependencies).toEqual([])
  })

  it('puts each subtask under its parent, indented, and draws the parent as one', () => {
    const parent = task('P', { plannedStart: '2027-03-01', plannedFinish: '2027-03-05' })
    const model = buildGanttModel(
      [parent, b, a],
      [relations('P'), relations('B', [], 'P'), relations('A', [], 'P')],
      [],
      calendar,
    )
    expect(model.rows.map((row) => [row.task.id, row.depth, row.parent])).toEqual([
      ['P', 0, true],
      ['B', 1, false],
      ['A', 1, false],
    ])
  })

  it('leaves off unscheduled and cancelled tasks, which are another part of the Gantt (SC-064)', () => {
    const unscheduled = task('U')
    const floating = task('F', { milestone: { variant: 'floating', date: null } })
    const cancelled = { ...b, status: 'cancelled' as const }
    const model = buildGanttModel(
      [a, unscheduled, floating, cancelled],
      [relations('A'), relations('U', ['A']), relations('F'), relations('B', ['A'])],
      [],
      calendar,
    )
    expect(model.rows.map((row) => row.task.id)).toEqual(['A'])
    expect(model.dependencies).toEqual([])
  })

  it('has no days when no task has dates', () => {
    expect(buildGanttModel([task('U')], [relations('U')], [], calendar)).toEqual({
      rows: [],
      dependencies: [],
      days: [],
    })
  })
})

describe('the path of a dependency arrow', () => {
  it('turns down to a task that starts after its blocker ends', () => {
    expect(arrowPath({ x: 128, y: 17 }, { x: 140, y: 57 }, 40)).toBe('M128 17 H134 V57 H140')
    expect(arrowPath({ x: 100, y: 17 }, { x: 200, y: 57 }, 40)).toBe('M100 17 H106 V57 H200')
  })

  it('goes round through the gap between the rows to a task that starts earlier', () => {
    expect(arrowPath({ x: 300, y: 17 }, { x: 100, y: 60 }, 40)).toBe(
      'M300 17 H306 V40 H90 V60 H100',
    )
  })
})

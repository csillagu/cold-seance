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
      { task: 'B', blocker: 'A', red: false, crossProject: false },
      { task: 'M', blocker: 'B', red: false, crossProject: false },
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
    expect(model.dependencies).toEqual([
      { task: 'M', blocker: 'A', red: true, crossProject: false },
    ])
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
    // The other project's milestone is not on this Gantt, so no line is drawn to it.
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

  it('lays the unscheduled tasks apart, below the scheduled ones, in the order given (SC-064)', () => {
    const unscheduled = task('U')
    const floating = task('F', { milestone: { variant: 'floating', date: null } })
    const model = buildGanttModel(
      [unscheduled, a, floating, b],
      [relations('U', ['A']), relations('A'), relations('F'), relations('B', ['A'])],
      [],
      calendar,
    )
    expect(model.rows.map((row) => row.task.id)).toEqual(['A', 'B'])
    expect(model.unscheduled.map((row) => row.task.id)).toEqual(['U', 'F'])
    // No dates are given to an unscheduled task, and no arrow is drawn to it.
    expect(model.unscheduled[0]!.task.plannedStart).toBeNull()
    expect(model.dependencies).toEqual([
      { task: 'B', blocker: 'A', red: false, crossProject: false },
    ])
  })

  it('keeps cancelled tasks on the Gantt, on their dates (FR-129)', () => {
    const cancelled = { ...b, status: 'cancelled' as const }
    const cancelledUnscheduled = task('X', { status: 'cancelled' })
    const model = buildGanttModel(
      [a, cancelled, cancelledUnscheduled],
      [relations('A'), relations('B', ['A']), relations('X')],
      [],
      calendar,
    )
    expect(model.rows.map((row) => [row.task.id, row.task.status, row.start, row.finish])).toEqual([
      ['A', 'not-started', '2027-03-01', '2027-03-03'],
      ['B', 'cancelled', '2027-03-04', '2027-03-05'],
    ])
    expect(model.unscheduled.map((row) => row.task.id)).toEqual(['X'])
    expect(model.dependencies).toEqual([
      { task: 'B', blocker: 'A', red: false, crossProject: false },
    ])
  })

  it('has no days when no task has dates', () => {
    expect(buildGanttModel([task('U')], [relations('U')], [], calendar)).toEqual({
      rows: [],
      unscheduled: [{ task: task('U'), baseline: null, pending: [] }],
      proposed: [],
      baseline: null,
      dependencies: [],
      days: [],
    })
  })
})

describe('the cross-project dependency lines (SC-066)', () => {
  const B = 'project-borealis'
  // TC-088's plan: M of Borealis on 2027-03-10, and T of Apollo blocked by M, from 2027-03-11.
  const milestone = task('M', {
    projectId: B,
    milestone: { variant: 'fixed-date', date: '2027-03-10' },
  })
  const t = task('T', {
    plannedStart: '2027-03-11',
    plannedFinish: '2027-03-12',
    durationWorkingDays: 2,
  })
  const crossRelations: ApiRelations[] = [
    { taskId: 'M', parent: null, blockedBy: [] },
    { taskId: 'T', parent: null, blockedBy: [{ id: 'M', projectId: B }] },
  ]

  it("TC-088: draws a task's dependency on another project's milestone, not in red", () => {
    const model = buildGanttModel([t, milestone], crossRelations, [], calendar)
    expect(model.rows.map((row) => [row.task.id, row.red])).toEqual([
      ['T', false],
      ['M', false],
    ])
    expect(model.dependencies).toEqual([
      { task: 'T', blocker: 'M', red: false, crossProject: true },
    ])
  })

  it("draws it in red when the milestone lies after the task's start", () => {
    const later = {
      ...milestone,
      milestone: { variant: 'fixed-date' as const, date: '2027-03-17' },
    }
    const flags: ApiRedFlag[] = [
      {
        kind: 'cross-project-dependency',
        task: ref('T'),
        blocker: { id: 'M', projectId: B },
        blockerFinish: '2027-03-17',
      },
    ]
    const model = buildGanttModel([t, later], crossRelations, flags, calendar)
    expect(model.rows.map((row) => [row.task.id, row.red])).toEqual([
      ['T', true],
      ['M', false],
    ])
    expect(model.dependencies).toEqual([{ task: 'T', blocker: 'M', red: true, crossProject: true }])
  })

  it("keeps a dependency within one project apart from a line to another project's", () => {
    const model = buildGanttModel(
      [a, t, milestone],
      [
        relations('A'),
        { taskId: 'T', parent: null, blockedBy: [ref('A'), { id: 'M', projectId: B }] },
        { taskId: 'M', parent: null, blockedBy: [] },
      ],
      [],
      calendar,
    )
    expect(model.dependencies).toEqual([
      { task: 'T', blocker: 'A', red: false, crossProject: false },
      { task: 'T', blocker: 'M', red: false, crossProject: true },
    ])
  })
})

describe('the baseline bars (SC-065)', () => {
  // TC-068's plan: T saved in v1 on 2027-03-01 to 2027-03-03, since moved to 2027-03-08.
  const t = task('T', {
    plannedStart: '2027-03-08',
    plannedFinish: '2027-03-10',
    durationWorkingDays: 3,
  })
  const v1 = {
    id: 'baseline-v1',
    name: 'v1',
    tasks: [{ taskId: 'T', plannedStart: '2027-03-01', plannedFinish: '2027-03-03' }],
  }

  it('gives each task the baseline holds dates for a bar on them', () => {
    const model = buildGanttModel([t], [relations('T')], [], calendar, v1)
    expect(model.baseline).toBe('v1')
    expect(model.rows).toHaveLength(1)
    expect(model.rows[0]).toMatchObject({
      start: '2027-03-08',
      finish: '2027-03-10',
      baseline: { start: '2027-03-01', finish: '2027-03-03' },
    })
    // The timeline spans the baseline's days as well as the planned ones.
    expect(model.days[0]!.date).toBe('2027-03-01')
  })

  it('draws no baseline bar with no baseline selected', () => {
    const model = buildGanttModel([t], [relations('T')], [], calendar)
    expect(model.baseline).toBeNull()
    expect(model.rows[0]!.baseline).toBeNull()
    expect(model.days[0]!.date).toBe('2027-03-08')
  })

  it("draws none for a task the baseline holds no dates for, and a milestone's on its day", () => {
    const later = task('L', { plannedStart: '2027-03-08', plannedFinish: '2027-03-08' })
    const milestone = task('M', { milestone: { variant: 'fixed-date', date: '2027-03-12' } })
    const unscheduled = task('U')
    const model = buildGanttModel(
      [t, later, milestone, unscheduled],
      [relations('T'), relations('L'), relations('M'), relations('U')],
      [],
      calendar,
      {
        ...v1,
        tasks: [
          ...v1.tasks,
          { taskId: 'L', plannedStart: null, plannedFinish: null },
          { taskId: 'M', plannedStart: '2027-03-11', plannedFinish: '2027-03-11' },
          { taskId: 'U', plannedStart: '2027-03-02', plannedFinish: '2027-03-04' },
        ],
      },
    )
    expect(model.rows.map((row) => [row.task.id, row.baseline])).toEqual([
      ['T', { start: '2027-03-01', finish: '2027-03-03' }],
      ['L', null],
      ['M', { start: '2027-03-11', finish: '2027-03-11' }],
    ])
    expect(model.unscheduled).toEqual([
      { task: unscheduled, baseline: { start: '2027-03-02', finish: '2027-03-04' }, pending: [] },
    ])
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

describe('the pending overlay (SC-068)', () => {
  const t = task('T', { plannedStart: '2027-03-01', plannedFinish: '2027-03-01' })
  const u = task('U')
  const after = (id: string, fields: Partial<ApiTask>) => ({
    ...task(id, fields),
    effort: null,
    personLoad: null,
    parentId: null,
    blockedBy: [],
  })

  it('draws a pending bar beside the live one, and a created task as a row of its own', () => {
    const model = buildGanttModel([t, u], [relations('T'), relations('U')], [], calendar, null, [
      {
        proposalId: 'x',
        taskId: 'T',
        created: false,
        after: after('T', { plannedStart: '2027-03-15', plannedFinish: '2027-03-16' }),
        assigneesChanged: false,
        lines: ['Start: 1 Mar 2027 → 15 Mar 2027'],
      },
      {
        proposalId: 'x',
        taskId: 'U',
        created: false,
        after: after('U', { plannedStart: '2027-03-02', plannedFinish: '2027-03-02' }),
        assigneesChanged: true,
        lines: [],
      },
      {
        proposalId: 'x',
        taskId: 'new-1',
        created: true,
        after: after('new-1', { title: 'N', milestone: { variant: 'floating', date: null } }),
        assigneesChanged: true,
        lines: [],
      },
    ])
    // The live plan is drawn as it is.
    expect(model.rows.map((row) => [row.task.id, row.start, row.finish])).toEqual([
      ['T', '2027-03-01', '2027-03-01'],
    ])
    expect(model.rows[0]!.pending).toEqual([
      {
        proposalId: 'x',
        start: '2027-03-15',
        finish: '2027-03-16',
        assignees: null,
        lines: ['Start: 1 Mar 2027 → 15 Mar 2027'],
      },
    ])
    expect(model.unscheduled.map((row) => [row.task.id, row.pending])).toEqual([
      [
        'U',
        [{ proposalId: 'x', start: '2027-03-02', finish: '2027-03-02', assignees: [], lines: [] }],
      ],
    ])
    expect(model.proposed).toEqual([
      {
        task: expect.objectContaining({ id: 'new-1', title: 'N' }),
        bar: { proposalId: 'x', start: null, finish: null, assignees: [], lines: [] },
      },
    ])
    // The timeline spans the pending bars too.
    expect(model.days.at(-1)!.date).toBe('2027-03-28')
  })
})

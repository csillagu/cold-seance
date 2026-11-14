import { describe, expect, it } from 'vitest'
import type { ApiRedFlag } from '../gantt/gantt-model.ts'
import { buildKanbanModel, datesLabel, type KanbanTask, movesFrom } from './kanban-model.ts'

const APOLLO = { id: 'apollo', name: 'Apollo' }
const BOREALIS = { id: 'borealis', name: 'Borealis' }

function task(id: string, fields: Partial<KanbanTask> = {}): KanbanTask {
  return {
    id,
    projectId: APOLLO.id,
    title: id,
    status: 'not-started',
    plannedStart: null,
    plannedFinish: null,
    durationWorkingDays: null,
    aiShare: null,
    milestone: null,
    assignees: [],
    actualFinish: null,
    ...fields,
  }
}

const scheduled = (id: string, start: string, fields: Partial<KanbanTask> = {}) =>
  task(id, { plannedStart: start, plannedFinish: start, durationWorkingDays: 1, ...fields })

const titles = (cards: readonly { task: KanbanTask }[]) => cards.map((card) => card.task.title)

describe('buildKanbanModel', () => {
  it('lays out one column per status, each task in the column of its status (FR-048, FR-129)', () => {
    const model = buildKanbanModel(
      [APOLLO],
      [
        task('New'),
        task('Doing', { status: 'in-progress' }),
        task('Paused', { status: 'on-hold' }),
        task('Finished', { status: 'done' }),
        task('Dropped', { status: 'cancelled' }),
      ],
      [],
    )
    expect(model.columns.map((column) => column.name)).toEqual([
      'Not started',
      'In progress',
      'On hold',
      'Done',
      'Cancelled',
    ])
    expect(model.columns.map((column) => titles(column.unscheduled))).toEqual([
      ['New'],
      ['Doing'],
      ['Paused'],
      ['Finished'],
      ['Dropped'],
    ])
  })

  it('orders scheduled tasks by start and lays unscheduled ones at the bottom (FR-004, FR-145)', () => {
    const model = buildKanbanModel(
      [APOLLO],
      [
        task('U'),
        scheduled('S2', '2027-03-08'),
        scheduled('S1', '2027-03-01'),
        scheduled('S1b', '2027-03-01'),
        task('No finish', { plannedStart: '2027-03-01' }),
        task('M', { milestone: { variant: 'fixed-date', date: '2027-03-05' } }),
        task('Floating', { milestone: { variant: 'floating', date: null } }),
      ],
      [],
    )
    const column = model.columns[0]!
    expect(titles(column.scheduled)).toEqual(['S1', 'S1b', 'M', 'S2'])
    expect(titles(column.unscheduled)).toEqual(['U', 'No finish', 'Floating'])
  })

  it('makes a card red, with a note, when a red flag names its task', () => {
    const flags: ApiRedFlag[] = [
      { kind: 'assignee-unavailable', task: { id: 'A', projectId: APOLLO.id } },
      {
        kind: 'fixed-date-milestone-pushed',
        task: { id: 'M', projectId: APOLLO.id },
        blocker: { id: 'B', projectId: APOLLO.id },
        blockerFinish: '2027-03-15',
      },
      { kind: 'cross-project-dependency', task: { id: 'C', projectId: APOLLO.id } },
      { kind: 'overload' },
    ]
    const model = buildKanbanModel(
      [APOLLO],
      [task('A'), task('B', { title: 'Load testing' }), task('M'), task('C'), task('D')],
      flags,
    )
    const cards = new Map(model.columns[0]!.unscheduled.map((card) => [card.task.id, card]))
    expect(cards.get('A')).toMatchObject({
      red: true,
      note: 'The people assigned cannot do it in its time',
    })
    expect(cards.get('M')).toMatchObject({
      red: true,
      note: 'Pushed past its fixed date: Load testing finishes 15 Mar',
    })
    expect(cards.get('C')).toMatchObject({
      red: true,
      note: "Starts before another project's milestone it depends on",
    })
    expect(cards.get('B')).toMatchObject({ red: false, note: null })
    expect(cards.get('D')).toMatchObject({ red: false, note: null })
  })

  it('names the project on each card only when it shows several projects', () => {
    const tasks = [task('A'), task('B', { projectId: BOREALIS.id })]
    const one = buildKanbanModel([APOLLO], [tasks[0]!], [])
    expect(one.columns[0]!.unscheduled[0]!.project).toBeNull()
    const several = buildKanbanModel([APOLLO, BOREALIS], tasks, [])
    expect(several.columns[0]!.unscheduled.map((card) => card.project?.name)).toEqual([
      'Apollo',
      'Borealis',
    ])
  })
})

describe('movesFrom', () => {
  it('offers every other status but not started, and nothing for a cancelled task', () => {
    expect(movesFrom('not-started')).toEqual(['in-progress', 'on-hold', 'done', 'cancelled'])
    expect(movesFrom('done')).toEqual(['in-progress', 'on-hold', 'cancelled'])
    expect(movesFrom('cancelled')).toEqual([])
  })
})

describe('datesLabel', () => {
  it('gives the planned dates and duration as the card shows them', () => {
    expect(
      datesLabel(
        task('T', {
          plannedStart: '2027-03-01',
          plannedFinish: '2027-03-03',
          durationWorkingDays: 3,
        }),
      ),
    ).toBe('1–3 Mar · 3d')
    expect(datesLabel(scheduled('T', '2027-03-03'))).toBe('3 Mar · 1d')
    expect(datesLabel(task('T', { plannedStart: '2027-02-26', plannedFinish: '2027-03-02' }))).toBe(
      '26 Feb – 2 Mar',
    )
    expect(
      datesLabel(task('M', { milestone: { variant: 'fixed-date', date: '2027-03-12' } })),
    ).toBe('12 Mar')
    expect(datesLabel(task('U'))).toBeNull()
  })
})

describe('the pending overlay (FR-073)', () => {
  const after = (id: string, fields: Partial<KanbanTask>) => {
    const { actualFinish: _actualFinish, ...live } = task(id, fields)
    return { ...live, effort: null, personLoad: null, parentId: null, blockedBy: [] }
  }

  it('lists what a proposal would change on the live card, and a created task apart', () => {
    const live = scheduled('Live', '2027-03-01')
    const model = buildKanbanModel(
      [APOLLO],
      [live],
      [],
      [
        {
          proposalId: 'x',
          taskId: 'Live',
          created: false,
          after: after('Live', { status: 'in-progress' }),
          assigneesChanged: false,
          lines: ['Status: not started → in progress'],
        },
        {
          proposalId: 'x',
          taskId: 'new-1',
          created: true,
          after: after('new-1', { title: 'Proposed task' }),
          assigneesChanged: true,
          lines: [],
        },
      ],
    )
    const [notStarted, inProgress] = model.columns
    // The live card stays in the column of its live status.
    expect(titles(notStarted!.scheduled)).toEqual(['Live'])
    expect(notStarted!.scheduled[0]!.pending).toEqual([
      { proposalId: 'x', lines: ['Status: not started → in progress'] },
    ])
    expect(inProgress!.scheduled).toEqual([])
    expect(notStarted!.proposed).toEqual([
      {
        proposalId: 'x',
        task: expect.objectContaining({ id: 'new-1', title: 'Proposed task', actualFinish: null }),
        project: null,
      },
    ])
    expect(titles(notStarted!.unscheduled)).toEqual([])
  })
})

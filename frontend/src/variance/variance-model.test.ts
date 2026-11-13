import { describe, expect, it } from 'vitest'
import type { ApiRelations } from '../gantt/gantt-model.ts'
import type { KanbanTask } from '../kanban/kanban-model.ts'
import {
  type ApiTaskVariance,
  type ApiVariance,
  buildVarianceModel,
  formatDates,
  formatVariance,
} from './variance-model.ts'

const none = { start: null, finish: null }

const variance = (tasks: ApiTaskVariance[]): ApiVariance => ({
  baseline: { id: 'b1', projectId: 'p1', name: 'v1', savedAt: '2027-02-26T10:00:00.000Z' },
  tasks,
})

const entry = (taskId: string, fields: Partial<ApiTaskVariance> = {}): ApiTaskVariance => ({
  taskId,
  title: taskId,
  milestone: false,
  baseline: none,
  planned: none,
  actual: none,
  variance: { start: null, finish: null },
  ...fields,
})

const task = (id: string, status: KanbanTask['status'] = 'not-started'): KanbanTask => ({
  id,
  projectId: 'p1',
  title: id,
  status,
  plannedStart: null,
  plannedFinish: null,
  durationWorkingDays: null,
  aiShare: null,
  milestone: null,
  assignees: [],
  actualFinish: null,
})

const relation = (taskId: string, parent: string | null): ApiRelations => ({
  taskId,
  parent: parent === null ? null : { id: parent, projectId: 'p1' },
  blockedBy: [],
})

describe('formatDates', () => {
  it('writes a span in short, and in full with the year', () => {
    expect(formatDates({ start: '2027-03-08', finish: '2027-03-10' })).toEqual({
      text: '8–10 Mar',
      full: '8 Mar 2027 to 10 Mar 2027',
    })
    expect(formatDates({ start: '2027-02-25', finish: '2027-03-01' }).text).toBe('25 Feb–1 Mar')
    expect(formatDates({ start: '2027-03-12', finish: '2027-03-12' })).toEqual({
      text: '12 Mar',
      full: '12 Mar 2027',
    })
  })

  it('writes a start with no finish as open, and no dates as a dash', () => {
    expect(formatDates({ start: '2027-03-01', finish: null })).toEqual({
      text: '1 Mar –',
      full: '1 Mar 2027, not finished',
    })
    expect(formatDates(none)).toEqual({ text: '—', full: null })
  })
})

describe('formatVariance', () => {
  it('signs a variance, with a minus sign for earlier, and dashes none', () => {
    expect(formatVariance(2)).toBe('+2')
    expect(formatVariance(-1)).toBe('−1')
    expect(formatVariance(0)).toBe('0')
    expect(formatVariance(null)).toBe('—')
  })
})

describe('buildVarianceModel (SC-033)', () => {
  it("shows a task's planned, baseline and actual dates side by side (FR-152)", () => {
    const model = buildVarianceModel(
      variance([
        entry('T', {
          baseline: { start: '2027-03-01', finish: '2027-03-03' },
          planned: { start: '2027-03-08', finish: '2027-03-10' },
          actual: { start: '2027-03-09', finish: null },
          variance: { start: 6, finish: 5 },
        }),
      ]),
      [task('T', 'in-progress')],
      [relation('T', null)],
      '2027-03-09',
    )
    expect(model.scheduled).toHaveLength(1)
    const [row] = model.scheduled
    expect(row).toMatchObject({
      planned: { text: '8–10 Mar' },
      baseline: { text: '1–3 Mar' },
      actual: { text: '9 Mar –' },
      start: '+6',
      finish: '+5',
      status: 'in-progress',
    })
    // The timeline runs from the Monday of the first date's week to the Sunday of the last's.
    expect(model.timeline).toMatchObject({ first: '2027-03-01', days: 14, today: 8 })
    expect(row!.bars).toEqual({
      planned: { from: 7, days: 3 },
      baseline: { from: 0, days: 3 },
      actual: { from: 8, days: 1 },
      open: true,
    })
    expect(model.summary).toEqual({ later: 1, on: 0, earlier: 0, none: 0 })
  })

  it('lists unscheduled tasks apart, with dashes, and gives them no dates (FR-004)', () => {
    const model = buildVarianceModel(
      variance([
        entry('Write guide', {
          baseline: { start: '2027-03-01', finish: '2027-03-02' },
          planned: { start: '2027-03-01', finish: '2027-03-02' },
          variance: { start: 0, finish: 0 },
        }),
        entry('Triage backlog', { baseline: null }),
      ]),
      [task('Write guide'), task('Triage backlog')],
      [],
      '2027-02-01',
    )
    expect(model.scheduled.map((row) => row.title)).toEqual(['Write guide'])
    expect(model.unscheduled).toHaveLength(1)
    expect(model.unscheduled[0]).toMatchObject({
      title: 'Triage backlog',
      planned: { text: '—' },
      baseline: { text: '—' },
      actual: { text: '—' },
      start: '—',
      finish: '—',
      bars: { planned: null, baseline: null, actual: null },
    })
    expect(model.timeline?.today).toBeNull()
    expect(model.summary).toEqual({ later: 0, on: 1, earlier: 0, none: 1 })
  })

  it('says a scheduled task created after the baseline is not in it', () => {
    const model = buildVarianceModel(
      variance([
        entry('New', { baseline: null, planned: { start: '2027-03-11', finish: '2027-03-12' } }),
      ]),
      [task('New')],
      [],
      '2027-03-01',
    )
    expect(model.scheduled[0]!.baseline).toEqual({ text: 'not in v1', full: null })
  })

  it('puts each subtask under its parent and counts the tasks by where they stand', () => {
    const dates = { start: '2027-03-01', finish: '2027-03-02' }
    const model = buildVarianceModel(
      variance([
        entry('Child', { baseline: dates, planned: dates, variance: { start: -1, finish: 0 } }),
        entry('Other', { baseline: dates, planned: dates, variance: { start: 0, finish: 0 } }),
        entry('Parent', { baseline: dates, planned: dates, variance: { start: 0, finish: 2 } }),
        entry('Gate', {
          milestone: true,
          baseline: { start: '2027-03-05', finish: '2027-03-05' },
          planned: { start: '2027-03-05', finish: '2027-03-05' },
          variance: { start: 0, finish: 0 },
        }),
      ]),
      [task('Child', 'done'), task('Other', 'cancelled'), task('Parent'), task('Gate')],
      [relation('Child', 'Parent'), relation('Other', null), relation('Parent', null)],
      '2027-03-01',
    )
    expect(model.scheduled.map((row) => [row.title, row.depth, row.note])).toEqual([
      ['Other', 0, 'cancelled'],
      ['Parent', 0, '1 subtask'],
      ['Child', 1, 'done'],
      ['Gate', 0, 'milestone'],
    ])
    // A milestone lies on one day: its finish variance is not shown apart.
    expect(model.scheduled[3]!.finish).toBeNull()
    expect(model.summary).toEqual({ later: 1, on: 2, earlier: 1, none: 0 })
  })
})

import { describe, expect, it } from 'vitest'
import {
  daysDragged,
  type GanttProject,
  movable,
  moveChanges,
  newTaskProject,
  resizable,
  resizeChanges,
  workingDays,
} from './gantt-edit.ts'
import { type ApiTask, weekday } from './gantt-model.ts'

const task: ApiTask = {
  id: 'a',
  projectId: 'apollo',
  title: 'A',
  status: 'not-started',
  plannedStart: '2027-03-01',
  plannedFinish: '2027-03-01',
  durationWorkingDays: 1,
  aiShare: null,
  milestone: null,
  assignees: [],
}
const fixed: ApiTask = {
  ...task,
  plannedStart: null,
  plannedFinish: null,
  durationWorkingDays: null,
  milestone: { variant: 'fixed-date', date: '2027-03-12' },
}
const floating: ApiTask = { ...fixed, milestone: { variant: 'floating', date: '2027-03-12' } }

describe('dragging a bar on the Gantt (SC-067)', () => {
  it('moves a task or a fixed-date milestone, but not a parent or a floating milestone', () => {
    expect(movable(task, false)).toBe(true)
    expect(movable(fixed, false)).toBe(true)
    expect(movable(task, true)).toBe(false)
    expect(movable(floating, false)).toBe(false)
  })

  it('freezes a closed task, done or cancelled (#223)', () => {
    expect(movable({ ...task, status: 'in-progress' }, false)).toBe(true)
    expect(movable({ ...task, status: 'on-hold' }, false)).toBe(true)
    expect(movable({ ...task, status: 'done' }, false)).toBe(false)
    expect(movable({ ...task, status: 'cancelled' }, false)).toBe(false)
    expect(movable({ ...fixed, status: 'done' }, false)).toBe(false)
  })

  it('moves by whole days, the nearest to how far the bar was dragged', () => {
    expect(daysDragged(44, 44)).toBe(1)
    expect(daysDragged(21, 44)).toBe(0)
    expect(daysDragged(-21, 44)).toBe(0)
    expect(Object.is(daysDragged(-21, 44), 0)).toBe(true)
    expect(daysDragged(-70, 44)).toBe(-2)
    expect(daysDragged(400, 44)).toBe(9)
  })

  it("changes a task's planned start, and a fixed-date milestone's date", () => {
    expect(moveChanges(task, '2027-03-01', 1)).toEqual({ plannedStart: '2027-03-02' })
    expect(moveChanges(task, '2027-03-01', -3)).toEqual({ plannedStart: '2027-02-26' })
    expect(moveChanges(fixed, '2027-03-12', 3)).toEqual({
      milestone: { variant: 'fixed-date', date: '2027-03-15' },
    })
  })
})

describe('resizing a bar by its ends on the Gantt (#223)', () => {
  // 2027-03-01 is a Monday; the weekends are the non-working days.
  const weekend = (date: string) => weekday(date) >= 5
  const week = { start: '2027-03-01', finish: '2027-03-05' }
  const fiveDays: ApiTask = { ...task, plannedFinish: '2027-03-05', durationWorkingDays: 5 }

  it('resizes a task that can be moved, but not a milestone, a parent or a closed task', () => {
    expect(resizable(task, false)).toBe(true)
    expect(resizable(fixed, false)).toBe(false)
    expect(resizable(floating, false)).toBe(false)
    expect(resizable(task, true)).toBe(false)
    expect(resizable({ ...task, status: 'done' }, false)).toBe(false)
    expect(resizable({ ...task, status: 'cancelled' }, false)).toBe(false)
  })

  it('counts the working days from one day to another, both included', () => {
    expect(workingDays('2027-03-01', '2027-03-07', weekend)).toBe(5)
    expect(workingDays('2027-03-06', '2027-03-07', weekend)).toBe(0)
    expect(workingDays('2027-03-02', '2027-03-01', weekend)).toBe(0)
  })

  it('changes only the duration when the right end is dragged, by the working days gained or lost', () => {
    expect(resizeChanges(fiveDays, week, 'finish', 3, weekend)).toEqual({ durationWorkingDays: 6 })
    expect(resizeChanges(fiveDays, week, 'finish', -2, weekend)).toEqual({
      durationWorkingDays: 3,
    })
  })

  it('changes the start and the duration when the left end is dragged, so the finish stays', () => {
    expect(resizeChanges(fiveDays, week, 'start', -3, weekend)).toEqual({
      plannedStart: '2027-02-26',
      durationWorkingDays: 6,
    })
    expect(resizeChanges(fiveDays, week, 'start', 2, weekend)).toEqual({
      plannedStart: '2027-03-03',
      durationWorkingDays: 3,
    })
  })

  it('stops an end at the day of the other, leaving one working day', () => {
    expect(resizeChanges(fiveDays, week, 'finish', -10, weekend)).toEqual({
      durationWorkingDays: 1,
    })
    expect(resizeChanges(fiveDays, week, 'start', 9, weekend)).toEqual({
      plannedStart: '2027-03-05',
      durationWorkingDays: 1,
    })
  })

  it('changes nothing when not dragged, or dragged onto non-working days only', () => {
    expect(resizeChanges(fiveDays, week, 'finish', 0, weekend)).toBeNull()
    expect(resizeChanges(fiveDays, week, 'start', 0, weekend)).toBeNull()
    expect(resizeChanges(fiveDays, week, 'finish', 2, weekend)).toBeNull()
  })

  it('takes a task with no duration to last the working days of its bar', () => {
    const noDuration = { ...fiveDays, durationWorkingDays: null }
    expect(resizeChanges(noDuration, week, 'finish', 3, weekend)).toEqual({
      durationWorkingDays: 6,
    })
  })
})

describe("a new task's project on the Gantt (FR-061)", () => {
  const apollo: GanttProject = { id: 'apollo', name: 'Apollo', writable: true }
  const borealis: GanttProject = { id: 'borealis', name: 'Borealis', writable: true }
  const ceres: GanttProject = { id: 'ceres', name: 'Ceres', writable: false }

  it('goes in the project of a Gantt of one project, without asking', () => {
    expect(newTaskProject([apollo])).toEqual({ ask: false, project: apollo })
  })

  it('is asked for on a Gantt of several, offering only the projects the viewer can write to', () => {
    // As TC-086: Apollo and Borealis offered, Ceres, read-only, not.
    expect(newTaskProject([apollo, borealis, ceres])).toEqual({
      ask: true,
      offered: [apollo, borealis],
    })
  })

  it("goes, without asking, in the only project the view's filter allows", () => {
    // As TC-087: a view of Apollo and Borealis filtered to Borealis.
    expect(newTaskProject([apollo, borealis], ['borealis'])).toEqual({
      ask: false,
      project: borealis,
    })
  })

  it("asks among the writable projects the view's filter allows, if it allows several", () => {
    expect(newTaskProject([apollo, borealis, ceres], ['borealis', 'ceres'])).toEqual({
      ask: true,
      offered: [borealis],
    })
  })

  it('offers none where the viewer can write to none', () => {
    expect(newTaskProject([ceres, { ...apollo, writable: false }])).toEqual({
      ask: true,
      offered: [],
    })
  })
})

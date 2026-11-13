import { describe, expect, it } from 'vitest'
import {
  daysDragged,
  type GanttProject,
  movable,
  moveChanges,
  newTaskProject,
} from './gantt-edit.ts'
import type { ApiTask } from './gantt-model.ts'

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

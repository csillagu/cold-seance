import { describe, expect, it } from 'vitest'
import {
  clampLabel,
  dayAt,
  drawChanges,
  drawMode,
  drawnSpan,
  drawnWorkingDays,
  edgeScroll,
  placeChanges,
  spanText,
  workingDaysText,
} from './gantt-draw.ts'
import { type ApiTask, weekday } from './gantt-model.ts'

const task: ApiTask = {
  id: 'u',
  projectId: 'apollo',
  title: 'U',
  status: 'not-started',
  plannedStart: null,
  plannedFinish: null,
  durationWorkingDays: null,
  aiShare: null,
  milestone: null,
  assignees: [],
}
// 2027-03-01 is a Monday; the weekends are the non-working days.
const weekend = (date: string) => weekday(date) >= 5

describe('drawing an unscheduled task on the Gantt (#228, SC-119)', () => {
  it("draws a task's bar, places a fixed-date milestone, and leaves the rest inert", () => {
    expect(drawMode(task)).toBe('bar')
    expect(drawMode({ ...task, status: 'in-progress' })).toBe('bar')
    expect(drawMode({ ...task, status: 'on-hold' })).toBe('bar')
    expect(drawMode({ ...task, milestone: { variant: 'fixed-date', date: null } })).toBe(
      'milestone',
    )
    expect(drawMode({ ...task, milestone: { variant: 'floating', date: null } })).toBeNull()
    expect(drawMode({ ...task, status: 'done' })).toBeNull()
    expect(drawMode({ ...task, status: 'cancelled' })).toBeNull()
  })

  it('finds the day under the pointer, within the timeline', () => {
    expect(dayAt(0, 44, 14)).toBe(0)
    expect(dayAt(43, 44, 14)).toBe(0)
    expect(dayAt(44, 44, 14)).toBe(1)
    expect(dayAt(-5, 44, 14)).toBe(0)
    expect(dayAt(44 * 20, 44, 14)).toBe(13)
  })

  it('starts on the earlier day, whichever way the bar is drawn', () => {
    const span = { start: '2027-03-03', finish: '2027-03-09' }
    expect(drawnSpan('2027-03-03', '2027-03-09')).toEqual(span)
    expect(drawnSpan('2027-03-09', '2027-03-03')).toEqual(span)
    expect(drawnSpan('2027-03-04', '2027-03-04')).toEqual({
      start: '2027-03-04',
      finish: '2027-03-04',
    })
  })

  it('saves the start and the working days the bar covers, not its finish', () => {
    expect(drawChanges({ start: '2027-03-03', finish: '2027-03-09' }, weekend)).toEqual({
      plannedStart: '2027-03-03',
      durationWorkingDays: 5,
    })
    expect(drawChanges({ start: '2027-03-01', finish: '2027-03-01' }, weekend)).toEqual({
      plannedStart: '2027-03-01',
      durationWorkingDays: 1,
    })
  })

  it('counts one working day at least, for a bar on non-working days alone', () => {
    expect(drawnWorkingDays({ start: '2027-03-06', finish: '2027-03-07' }, weekend)).toBe(1)
  })

  it('places a fixed-date milestone on the day clicked', () => {
    expect(placeChanges('2027-03-03')).toEqual({
      milestone: { variant: 'fixed-date', date: '2027-03-03' },
    })
  })

  it('says the days and the working days as the labels show them', () => {
    expect(spanText({ start: '2027-03-03', finish: '2027-03-07' })).toBe('3 Mar – 7 Mar')
    expect(spanText({ start: '2027-03-03', finish: '2027-03-03' })).toBe('3 Mar')
    expect(workingDaysText(1)).toBe('1 working day')
    expect(workingDaysText(5)).toBe('5 working days')
  })

  it('keeps a label within the part of the timeline in view', () => {
    expect(clampLabel(100, 50, 0, 500)).toBe(100)
    expect(clampLabel(-30, 50, 0, 500)).toBe(0)
    expect(clampLabel(480, 50, 0, 500)).toBe(450)
    expect(clampLabel(10, 600, 0, 500)).toBe(0)
  })

  it('scrolls the timeline near its edges, faster closer to them, and not away from them', () => {
    expect(edgeScroll(250, 0, 500)).toBe(0)
    expect(edgeScroll(20, 0, 500)).toBeLessThan(0)
    expect(edgeScroll(480, 0, 500)).toBeGreaterThan(0)
    expect(edgeScroll(495, 0, 500)).toBeGreaterThan(edgeScroll(470, 0, 500))
    expect(edgeScroll(600, 0, 500)).toBe(16)
    expect(edgeScroll(-100, 0, 500)).toBe(-16)
  })
})

import { describe, expect, it } from 'vitest'
import { type DependencyEnd, violationOf } from './violations.ts'

// The rule of a single dependency, without a database; the queries and who sees what are tested
// against PostgreSQL in test/integration/violations.test.ts.

const APOLLO = 'apollo'
const BOREALIS = 'borealis'

const none = {
  milestoneVariant: null,
  plannedStart: null,
  plannedFinish: null,
  milestoneDate: null,
  floatingDate: null,
} as const

function work(id: string, projectId: string, start: string | null, finish: string | null) {
  return { ...none, id, projectId, title: id, plannedStart: start, plannedFinish: finish }
}

function fixed(id: string, projectId: string, date: string): DependencyEnd {
  return { ...none, id, projectId, title: id, milestoneVariant: 'fixed-date', milestoneDate: date }
}

function floating(id: string, projectId: string, date: string | null): DependencyEnd {
  return { ...none, id, projectId, title: id, milestoneVariant: 'floating', floatingDate: date }
}

describe('violationOf', () => {
  describe('a fixed-date milestone (FR-013)', () => {
    it('is pushed when work it depends on finishes after its date', () => {
      const task = fixed('M', APOLLO, '2027-03-12')
      const blocker = work('A', APOLLO, '2027-03-01', '2027-03-19')
      expect(violationOf({ task, blocker })).toEqual({
        kind: 'fixed-date-milestone-pushed',
        task: { id: 'M', projectId: APOLLO, title: 'M' },
        blocker: { id: 'A', projectId: APOLLO, title: 'A' },
        crossProject: false,
        start: '2027-03-12',
        blockerFinish: '2027-03-19',
      })
    })

    it('is not pushed by work finishing before or on its date', () => {
      const task = fixed('M', APOLLO, '2027-03-12')
      expect(violationOf({ task, blocker: work('A', APOLLO, null, '2027-03-05') })).toBeNull()
      expect(violationOf({ task, blocker: work('A', APOLLO, null, '2027-03-12') })).toBeNull()
    })

    it('is not pushed by work with no finish', () => {
      const task = fixed('M', APOLLO, '2027-03-12')
      expect(violationOf({ task, blocker: work('A', APOLLO, '2027-03-01', null) })).toBeNull()
    })

    it('is pushed by a fixed-date or floating milestone it depends on lying after its date', () => {
      const task = fixed('M', APOLLO, '2027-03-12')
      expect(violationOf({ task, blocker: fixed('N', APOLLO, '2027-03-15') })).toMatchObject({
        kind: 'fixed-date-milestone-pushed',
        blockerFinish: '2027-03-15',
      })
      expect(violationOf({ task, blocker: floating('F', APOLLO, '2027-03-16') })).toMatchObject({
        kind: 'fixed-date-milestone-pushed',
        blockerFinish: '2027-03-16',
      })
      expect(violationOf({ task, blocker: floating('F', APOLLO, null) })).toBeNull()
    })

    it("is pushed by another project's milestone once, marked as crossing a project boundary", () => {
      const task = fixed('M', APOLLO, '2027-03-12')
      expect(violationOf({ task, blocker: fixed('X', BOREALIS, '2027-03-15') })).toMatchObject({
        kind: 'fixed-date-milestone-pushed',
        crossProject: true,
      })
    })
  })

  describe("a dependency on another project's milestone (FR-019, FR-147)", () => {
    it("is red when the milestone lies after the task's start", () => {
      const task = work('T', APOLLO, '2027-03-11', '2027-03-12')
      const blocker = fixed('M', BOREALIS, '2027-03-17')
      expect(violationOf({ task, blocker })).toEqual({
        kind: 'cross-project-dependency',
        task: { id: 'T', projectId: APOLLO, title: 'T' },
        blocker: { id: 'M', projectId: BOREALIS, title: 'M' },
        crossProject: true,
        start: '2027-03-11',
        blockerFinish: '2027-03-17',
      })
    })

    it("is not red when the milestone lies before or on the task's start", () => {
      const task = work('T', APOLLO, '2027-03-11', '2027-03-12')
      expect(violationOf({ task, blocker: fixed('M', BOREALIS, '2027-03-10') })).toBeNull()
      expect(violationOf({ task, blocker: fixed('M', BOREALIS, '2027-03-11') })).toBeNull()
    })

    it("takes a floating milestone's date, and none while it has no date", () => {
      const task = work('T', APOLLO, '2027-03-11', '2027-03-12')
      expect(violationOf({ task, blocker: floating('M', BOREALIS, '2027-03-12') })).toMatchObject({
        kind: 'cross-project-dependency',
        blockerFinish: '2027-03-12',
      })
      expect(violationOf({ task, blocker: floating('M', BOREALIS, null) })).toBeNull()
    })

    it('is not red for an unscheduled task, which has no start', () => {
      const task = work('T', APOLLO, null, null)
      expect(violationOf({ task, blocker: fixed('M', BOREALIS, '2027-03-17') })).toBeNull()
    })

    it("takes a dependent floating milestone's date as its start", () => {
      const blocker = fixed('M', BOREALIS, '2027-03-17')
      expect(violationOf({ task: floating('F', APOLLO, '2027-03-15'), blocker })).toMatchObject({
        kind: 'cross-project-dependency',
        start: '2027-03-15',
      })
      expect(violationOf({ task: floating('F', APOLLO, null), blocker })).toBeNull()
    })
  })

  describe('any other dependency', () => {
    it("is the scheduler's to keep within a project, so never a violation", () => {
      // Such dates do not arise from the scheduler; even so, nothing is reported.
      const task = work('B', APOLLO, '2027-03-01', '2027-03-02')
      expect(violationOf({ task, blocker: work('A', APOLLO, null, '2027-03-10') })).toBeNull()
      expect(violationOf({ task, blocker: fixed('M', APOLLO, '2027-03-10') })).toBeNull()
      const milestone = floating('F', APOLLO, '2027-03-01')
      expect(violationOf({ task: milestone, blocker: fixed('M', APOLLO, '2027-03-10') })).toBeNull()
    })

    it('is not a violation across projects when the blocker is no milestone', () => {
      // Of another project, only a milestone can block a task (SC-002).
      const task = work('T', APOLLO, '2027-03-01', '2027-03-02')
      expect(violationOf({ task, blocker: work('A', BOREALIS, null, '2027-03-10') })).toBeNull()
    })
  })
})

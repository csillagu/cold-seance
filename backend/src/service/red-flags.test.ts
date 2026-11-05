import { describe, expect, it } from 'vitest'
import { changesFor, type FoundFlag, flagsOf } from './red-flags.ts'
import type { Violation } from './violations.ts'

const violation: Violation = {
  kind: 'cross-project-dependency',
  task: { id: 'T', projectId: 'apollo', title: 'T' },
  blocker: { id: 'M', projectId: 'borealis', title: 'M' },
  crossProject: true,
  start: '2027-03-01',
  blockerFinish: '2027-03-05',
}

describe('flagsOf', () => {
  it("raises a person's overload in every project involved (FR-043)", () => {
    const flags = flagsOf({
      overloads: [{ accountId: 'carol', date: '2027-03-01', projects: ['apollo', 'borealis'] }],
      unavailable: [],
      violations: [],
    })
    expect(flags).toEqual([
      {
        projectId: 'apollo',
        kind: 'overload',
        key: 'overload:carol:2027-03-01',
        detail: { accountId: 'carol', date: '2027-03-01' },
      },
      {
        projectId: 'borealis',
        kind: 'overload',
        key: 'overload:carol:2027-03-01',
        detail: { accountId: 'carol', date: '2027-03-01' },
      },
    ])
  })

  it("raises a task its people cannot do in its time in the task's project (FR-020)", () => {
    const flags = flagsOf({
      overloads: [],
      unavailable: [{ taskId: 'T', projectId: 'apollo', overloads: [], holiday: true }],
      violations: [],
    })
    expect(flags).toEqual([
      {
        projectId: 'apollo',
        kind: 'assignee-unavailable',
        key: 'assignee-unavailable:T',
        detail: { task: { id: 'T', projectId: 'apollo' }, overloads: [], holiday: true },
      },
    ])
  })

  it('raises a violation across a project boundary in both projects (FR-147), others in one', () => {
    const within: Violation = {
      ...violation,
      kind: 'fixed-date-milestone-pushed',
      blocker: { id: 'A', projectId: 'apollo', title: 'A' },
      crossProject: false,
    }
    const flags = flagsOf({ overloads: [], unavailable: [], violations: [violation, within] })
    expect(flags.map((flag) => [flag.projectId, flag.key])).toEqual([
      ['apollo', 'cross-project-dependency:T:M'],
      ['borealis', 'cross-project-dependency:T:M'],
      ['apollo', 'fixed-date-milestone-pushed:T:A'],
    ])
  })
})

describe('changesFor', () => {
  const overload = (projectId: string, date: string): FoundFlag => ({
    projectId,
    kind: 'overload',
    key: `overload:carol:${date}`,
    detail: { accountId: 'carol', date },
  })

  it('raises what is found and not stored, and clears what is stored and no longer found (FR-021)', () => {
    const changes = changesFor(
      [
        { id: 'kept', projectId: 'apollo', key: 'overload:carol:2027-03-01', detail: {} },
        { id: 'gone', projectId: 'apollo', key: 'overload:carol:2027-03-02', detail: {} },
      ],
      [overload('apollo', '2027-03-01'), overload('apollo', '2027-03-03')],
    )
    expect(changes.raise).toEqual([overload('apollo', '2027-03-03')])
    expect(changes.clear.map((flag) => flag.id)).toEqual(['gone'])
  })

  it('tells the same conflict in two projects apart', () => {
    const changes = changesFor(
      [{ id: 'a', projectId: 'apollo', key: 'overload:carol:2027-03-01', detail: {} }],
      [overload('borealis', '2027-03-01')],
    )
    expect(changes.raise).toEqual([overload('borealis', '2027-03-01')])
    expect(changes.clear.map((flag) => flag.id)).toEqual(['a'])
  })

  it('updates the detail of a flag still raised only when it changed, whatever its keys order', () => {
    const found = overload('apollo', '2027-03-01')
    const same = changesFor(
      [
        {
          id: 'a',
          projectId: 'apollo',
          key: found.key,
          detail: { date: '2027-03-01', accountId: 'carol' },
        },
      ],
      [found],
    )
    expect(same).toEqual({ raise: [], clear: [], update: [] })
    const changed = changesFor(
      [{ id: 'a', projectId: 'apollo', key: found.key, detail: { accountId: 'dave' } }],
      [found],
    )
    expect(changed.update).toEqual([{ id: 'a', detail: found.detail }])
  })
})

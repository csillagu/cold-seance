import { describe, expect, it } from 'vitest'
import {
  type ApiPreview,
  buildPreviewModel,
  type Names,
  type PreviewTask,
} from './preview-model.ts'

const APOLLO = 'p-apollo'
const ZEUS = 'p-zeus'
const ALICE = 'u-alice'
const BOB = 'u-bob'

const names: Names = {
  people: new Map([
    [ALICE, 'alice'],
    [BOB, 'bob'],
  ]),
  projects: new Map([
    [APOLLO, 'Apollo'],
    [ZEUS, 'Zeus'],
  ]),
  tasks: new Map([
    ['A', 'A'],
    ['B', 'B'],
    ['P', 'P'],
  ]),
}

function task(id: string, fields: Partial<PreviewTask> = {}): PreviewTask {
  return {
    id,
    projectId: APOLLO,
    title: id,
    status: 'not-started',
    plannedStart: '2027-03-01',
    plannedFinish: '2027-03-03',
    durationWorkingDays: 3,
    effort: null,
    aiShare: 0,
    personLoad: 100,
    milestone: null,
    assignees: [],
    parentId: null,
    blockedBy: [],
    ...fields,
  }
}

const preview = (fields: Partial<ApiPreview>): ApiPreview => ({
  proposalId: 'x',
  planVersion: 'v1',
  differences: [],
  newRedFlags: [],
  ...fields,
})

describe('the proposal preview model (SC-034)', () => {
  it('gives each changed task before and after, marking what changes', () => {
    const model = buildPreviewModel(
      preview({
        differences: [
          {
            taskId: 'A',
            projectId: APOLLO,
            newTask: null,
            before: task('A'),
            after: task('A', { plannedFinish: '2027-03-05', durationWorkingDays: 5 }),
          },
          {
            taskId: 'B',
            projectId: APOLLO,
            newTask: null,
            before: task('B', { plannedStart: '2027-03-04', plannedFinish: '2027-03-05' }),
            after: task('B', {
              plannedStart: '2027-03-08',
              plannedFinish: '2027-03-09',
              assignees: [BOB],
            }),
          },
        ],
      }),
      names,
    )

    expect(model.rows).toHaveLength(2)
    const [a, b] = model.rows
    expect(a).toMatchObject({
      title: 'A',
      project: 'Apollo',
      created: false,
      start: { before: '1 Mar 2027', after: '1 Mar 2027', changed: false },
      finish: { before: '3 Mar 2027', after: '5 Mar 2027', changed: true },
      days: { before: '3', after: '5', changed: true },
      assigned: { before: '—', after: '—', changed: false },
      other: [],
    })
    expect(b).toMatchObject({
      start: { before: '4 Mar 2027', after: '8 Mar 2027', changed: true },
      finish: { before: '5 Mar 2027', after: '9 Mar 2027', changed: true },
      assigned: { before: '—', after: 'bob', changed: true },
    })
  })

  it('says every other change in words, naming tasks as the proposal would leave them', () => {
    const model = buildPreviewModel(
      preview({
        differences: [
          {
            taskId: 'A',
            projectId: APOLLO,
            newTask: null,
            before: task('A', { blockedBy: ['B'] }),
            after: task('A', {
              title: 'A2',
              status: 'in-progress',
              parentId: 'N',
              blockedBy: ['B', 'N'],
              aiShare: 50,
              eligibility: { any: [ALICE] },
            }),
          },
          {
            taskId: 'N',
            projectId: APOLLO,
            newTask: 'N',
            before: null,
            after: task('N', { title: 'New one', blockedBy: ['B'] }),
          },
        ],
      }),
      names,
    )

    expect(model.rows[0]?.other).toEqual([
      'Title: A → A2',
      'Status: not started → in progress',
      'Parent: — → New one',
      'Blocked by: B → B, New one',
      'AI share: 0% → 50%',
      'Eligibility changed',
    ])
    expect(model.rows[1]).toMatchObject({
      title: 'New one',
      created: true,
      start: { before: null, after: '1 Mar 2027', changed: true },
      other: ['Blocked by: B', 'AI share: 0%'],
    })
  })

  it('shows a milestone on its date, with no duration', () => {
    const milestone = { variant: 'fixed-date', date: '2027-03-12' } as const
    const model = buildPreviewModel(
      preview({
        differences: [
          {
            taskId: 'M',
            projectId: APOLLO,
            newTask: null,
            before: task('M', { milestone, plannedStart: null, plannedFinish: null }),
            after: task('M', {
              milestone: { ...milestone, date: '2027-03-15' },
              plannedStart: null,
              plannedFinish: null,
            }),
          },
        ],
      }),
      names,
    )
    expect(model.rows[0]).toMatchObject({
      start: { before: '12 Mar 2027', after: '15 Mar 2027' },
      finish: { before: '12 Mar 2027', after: '15 Mar 2027' },
      days: { before: '—', after: '—', changed: false },
      other: ['Milestone: fixed-date, 12 Mar 2027 → fixed-date, 15 Mar 2027'],
    })
  })

  it('says each new red flag once, with the projects it would be raised in', () => {
    const model = buildPreviewModel(
      preview({
        differences: [
          {
            taskId: 'B',
            projectId: APOLLO,
            newTask: null,
            before: task('B'),
            after: task('B', { title: 'B renamed' }),
          },
        ],
        newRedFlags: [
          { kind: 'overload', projectId: APOLLO, accountId: ALICE, date: '2027-03-09' },
          { kind: 'overload', projectId: ZEUS, accountId: ALICE, date: '2027-03-09' },
          { kind: 'assignee-unavailable', projectId: APOLLO, task: { id: 'A', projectId: APOLLO } },
          {
            kind: 'fixed-date-milestone-pushed',
            projectId: APOLLO,
            task: { id: 'P', projectId: APOLLO },
            blocker: { id: 'B', projectId: APOLLO },
            start: '2027-03-12',
            blockerFinish: '2027-03-19',
          },
          {
            kind: 'cross-project-dependency',
            projectId: ZEUS,
            task: { id: 'Z', projectId: ZEUS },
            blocker: { id: 'A', projectId: APOLLO },
            start: '2027-03-02',
            blockerFinish: '2027-03-03',
          },
        ],
      }),
      names,
    )
    expect(model.flags).toEqual([
      { text: 'alice overloaded on 9 Mar 2027', projects: ['Apollo', 'Zeus'] },
      { text: 'A: its assigned people cannot do it in its time', projects: ['Apollo'] },
      {
        text: 'P: fixed-date milestone pushed, as B renamed finishes 19 Mar 2027',
        projects: ['Apollo'],
      },
      {
        text: 'a task not visible to you starts 2 Mar 2027, before A of another project finishes 3 Mar 2027',
        projects: ['Zeus'],
      },
    ])
  })
})

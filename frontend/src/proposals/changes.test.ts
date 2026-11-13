import { describe, expect, it } from 'vitest'
import { conflictWords, describeChange, DraftError, groupDraft, groupPayload } from './changes.ts'
import type { ApiChange, ApiGroup } from './proposal.ts'

const P = 'project'
const names = {
  tasks: new Map([
    ['a', 'A'],
    ['b', 'B'],
  ]),
}

const change = (fields: Partial<ApiChange> & { kind: string }): ApiChange => ({
  id: 'c',
  projectId: P,
  ...fields,
})

describe('describeChange', () => {
  const create = change({
    kind: 'create-task',
    key: 'n1',
    fields: { title: 'New', durationWorkingDays: 2 },
  })
  const groups: ApiGroup[] = [{ id: 'g', changes: [create] }]

  it.each([
    [create, 'Create task “New”: duration in working days 2'],
    [
      change({
        kind: 'update-task',
        task: { taskId: 'a' },
        fields: { title: 'X', plannedStart: null },
      }),
      'Change A: title “X”, planned start none',
    ],
    [
      change({ kind: 'set-parent', task: { taskId: 'a' }, parent: { newTask: 'n1' } }),
      'Put A under New',
    ],
    [
      change({ kind: 'set-parent', task: { taskId: 'a' }, parent: null }),
      'Take A out of its parent',
    ],
    [
      change({ kind: 'add-blocker', task: { taskId: 'a' }, blocker: { taskId: 'b' } }),
      'Make A blocked by B',
    ],
    [
      change({ kind: 'remove-blocker', task: { taskId: 'a' }, blocker: { taskId: 'gone' } }),
      'Make A no longer blocked by a deleted task',
    ],
    [change({ kind: 'set-status', task: { taskId: 'b' }, status: 'done' }), 'Set B to done'],
    [change({ kind: 'cancel-task', task: { taskId: 'b' } }), 'Cancel B'],
    [
      change({ kind: 'assign-repository', task: { taskId: 'b' }, repositoryId: 'r' }),
      'Assign B to a repository',
    ],
  ])('says %o as %s', (given, words) => {
    expect(describeChange(given, names, groups)).toBe(words)
  })
})

describe('conflictWords', () => {
  it('names the inputs someone else edited', () => {
    expect(
      conflictWords(
        {
          groupId: 'g',
          changeId: 'c',
          taskId: 'a',
          reason: 'edited',
          inputs: ['plannedStart', 'blocker', 'status'],
        },
        names,
      ),
    ).toBe(
      'Someone else changed the planned start, blocker and status of A after the change was proposed.',
    )
  })

  it('says the task was deleted', () => {
    expect(
      conflictWords(
        { groupId: 'g', changeId: 'c', taskId: 'x', reason: 'deleted', inputs: [] },
        names,
      ),
    ).toBe('Its task was deleted after the change was proposed.')
  })
})

describe('groupDraft and groupPayload', () => {
  it('types the simple fields, keeps the others, and gives the change back without id', () => {
    const group: ApiGroup = {
      id: 'g',
      changes: [
        change({
          kind: 'create-task',
          key: 'n1',
          fields: { title: 'New', effort: 3, eligibility: { any: ['x'] }, plannedStart: 7 },
        }),
      ],
    }
    const draft = groupDraft(group)
    const [only] = draft.changes
    expect(only?.fields.map((f) => [f.name, f.value])).toEqual([
      ['title', 'New'],
      ['effort', '3'],
    ])
    // A value the editor cannot type, as an odd type given, is kept as it is.
    expect(only?.kept).toEqual(['Eligibility', 'Planned start'])
    const edited = {
      ...draft,
      changes: draft.changes.map((c) => ({
        ...c,
        fields: c.fields.map((f) => (f.name === 'effort' ? { ...f, value: ' 4.5 ' } : f)),
      })),
    }
    expect(groupPayload(edited)).toEqual({
      changes: [
        {
          kind: 'create-task',
          key: 'n1',
          projectId: P,
          fields: { title: 'New', effort: 4.5, eligibility: { any: ['x'] }, plannedStart: 7 },
        },
      ],
    })
  })

  it('refuses a number that is not one', () => {
    const draft = groupDraft({
      id: 'g',
      changes: [change({ kind: 'update-task', task: { taskId: 'a' }, fields: { effort: 1 } })],
    })
    const [only] = draft.changes
    if (!only) throw new Error('no change')
    const bad = { ...draft, changes: [{ ...only, fields: [{ ...only.fields[0]!, value: 'x' }] }] }
    expect(() => groupPayload(bad)).toThrow(DraftError)
    expect(() => groupPayload(bad)).toThrow('Effort must be a number')
  })
})

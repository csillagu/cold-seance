import { describe, expect, it } from 'vitest'
import { type ApiNotification, type Names, projectsNamed, viewOf } from './notification.ts'

const APOLLO = '00000000-0000-4000-8000-0000000000a0'
const BOREALIS = '00000000-0000-4000-8000-0000000000b0'
const ALICE = '00000000-0000-4000-8000-0000000000a1'
const BOB = '00000000-0000-4000-8000-0000000000b1'
const T = '00000000-0000-4000-8000-00000000000t'
const M = '00000000-0000-4000-8000-00000000000m'

const names: Names = {
  me: ALICE,
  projects: new Map([
    [APOLLO, 'Apollo'],
    [BOREALIS, 'Borealis'],
  ]),
  tasks: new Map([
    [T, 'T'],
    [M, 'M'],
  ]),
  people: new Map([
    [ALICE, 'alice'],
    [BOB, 'bob'],
  ]),
}

const at = '2026-11-14T10:00:00.000Z'
const notice = (kind: ApiNotification['kind'], detail: ApiNotification['detail']) =>
  ({ id: 'n1', kind, createdAt: at, detail }) satisfies ApiNotification

describe('a notification in words (SC-035)', () => {
  it("tells the reader of their own overload, and leads to the project's person load", () => {
    const view = viewOf(
      notice('red-flag', {
        flagKind: 'overload',
        projectIds: [APOLLO],
        accountId: ALICE,
        date: '2027-03-01',
      }),
      names,
    )
    expect(view).toEqual({
      id: 'n1',
      label: 'Red flag',
      text: 'You are overloaded on 1 Mar 2027 in Apollo.',
      link: `/projects/${APOLLO}/load`,
      createdAt: at,
    })
  })

  it("names someone else's overload by their username", () => {
    const view = viewOf(
      notice('red-flag', {
        flagKind: 'overload',
        projectIds: [APOLLO],
        accountId: BOB,
        date: '2027-03-01',
      }),
      names,
    )
    expect(view.text).toBe('bob is overloaded on 1 Mar 2027 in Apollo.')
  })

  it('tells a cross-project dependency with both tasks, and leads to the task', () => {
    const view = viewOf(
      notice('red-flag', {
        flagKind: 'cross-project-dependency',
        projectIds: [APOLLO, BOREALIS],
        task: { id: T, projectId: APOLLO },
        blocker: { id: M, projectId: BOREALIS },
        start: '2027-03-11',
        blockerFinish: '2027-03-17',
      }),
      names,
    )
    expect(view.text).toBe(
      'T starts 11 Mar 2027, before M finishes 17 Mar 2027 in Apollo and Borealis.',
    )
    expect(view.link).toBe(`/tasks/${T}`)
  })

  it('leaves out a task the reader cannot read, and leads to the one they can', () => {
    const view = viewOf(
      notice('red-flag', {
        flagKind: 'cross-project-dependency',
        projectIds: [BOREALIS],
        task: null,
        blocker: { id: M, projectId: BOREALIS },
        start: '2027-03-11',
        blockerFinish: '2027-03-17',
      }),
      names,
    )
    expect(view.text).toBe(
      'A task of another project starts 11 Mar 2027, before M finishes 17 Mar 2027 in Borealis.',
    )
    expect(view.link).toBe(`/tasks/${M}`)
  })

  it('tells a pushed fixed-date milestone and an assignee unavailable', () => {
    const pushed = viewOf(
      notice('red-flag', {
        flagKind: 'fixed-date-milestone-pushed',
        projectIds: [APOLLO],
        task: { id: M, projectId: APOLLO },
        blocker: { id: T, projectId: APOLLO },
        blockerFinish: '2027-03-17',
      }),
      names,
    )
    expect(pushed.text).toBe('M in Apollo is pushed past its date, as T finishes 17 Mar 2027.')
    const unavailable = viewOf(
      notice('red-flag', {
        flagKind: 'assignee-unavailable',
        projectIds: [APOLLO],
        task: { id: T, projectId: APOLLO },
      }),
      names,
    )
    expect(unavailable.text).toBe('T in Apollo: its assigned people cannot do it in its time.')
  })

  it('leads a proposal waiting for review to the proposal', () => {
    const view = viewOf(
      notice('proposal-waiting', { proposalId: 'p1', projectIds: [APOLLO] }),
      names,
    )
    expect(view).toMatchObject({
      label: 'Proposal',
      text: 'A proposal changing Apollo is waiting for your review.',
      link: '/proposals/p1',
    })
  })

  it('leads a repository request to the inbox', () => {
    const view = viewOf(
      notice('repository-request', {
        requestId: 'r1',
        project: { id: APOLLO, name: 'Apollo' },
        repository: { id: 'x', owner: 'csillagu', name: 'tc-repo' },
        requestedBy: { accountId: ALICE, username: 'alice' },
      }),
      names,
    )
    expect(view).toMatchObject({
      text: 'Apollo asks to add csillagu/tc-repo, asked by alice.',
      link: '/repository-requests',
    })
  })

  it('tells a refused GitHub token, leading nowhere', () => {
    const view = viewOf(notice('token-refused', { function: 'writeIssues' }), names)
    expect(view.text).toBe(
      'GitHub refused the personal access token for writing to issues as expired or revoked. ' +
        'It stops working until the tool is restarted with a new token.',
    )
    expect(view.link).toBeNull()
  })

  it('writes what it cannot name in general words', () => {
    const none: Names = { me: undefined, projects: new Map(), tasks: new Map(), people: new Map() }
    const view = viewOf(
      notice('red-flag', {
        flagKind: 'overload',
        projectIds: [APOLLO],
        accountId: BOB,
        date: '2027-03-01',
      }),
      none,
    )
    expect(view.text).toBe('Someone is overloaded on 1 Mar 2027.')
  })

  it('names the projects of the flag and of its tasks', () => {
    expect(
      projectsNamed(
        notice('red-flag', {
          projectIds: [APOLLO],
          task: { id: T, projectId: APOLLO },
          blocker: { id: M, projectId: BOREALIS },
        }),
      ),
    ).toEqual([APOLLO, BOREALIS])
  })
})

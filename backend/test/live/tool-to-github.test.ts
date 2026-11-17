import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { LiveRun } from './run.ts'
import { eventually } from './settings.ts'

// The GitHub steps of the test cases on what the tool writes to GitHub (SC-022, SC-060, SC-061),
// run against the test deployment and the real test repository (SC-126, DD-062). The tool writes
// to GitHub as soon as a change is committed, in the background, so each check waits a minute at
// most. The test cases' fresh deployment is a project of this run's own (see LiveRun).

let run: LiveRun
/** The suite's GitHub user, standing for the test cases' `tc-alice`. */
let login: string

beforeAll(async () => {
  run = await LiveRun.start()
  login = await run.github.login()
  // The first system admin stands for alice; their account is linked to the suite's GitHub user.
  await run.tool.call('PUT', `/accounts/${run.tool.accountId}/github`, { githubLogin: login })
})

afterAll(async () => {
  await run?.cleanUp()
})

const soon = <T>(check: () => Promise<T>) => eventually(check, 60_000, 3_000)

describe.concurrent('what the tool writes to GitHub, live', () => {
  it('TC-124: a task assigned to a repository gets its GitHub issue there (live)', async () => {
    const apollo = await run.project('TC-124')
    const task = await run.createTask(apollo, { title: `Write guide ${run.tag}` })
    expect(task.githubIssue).toBeNull()

    // Step 1: assign Write guide to the test repository. Step 2: read the issue back.
    const issue = await run.assign(task)
    expect(issue).toMatchObject({ title: `Write guide ${run.tag}`, state: 'open' })
    expect((await run.tool.task(task.id)).githubIssue).toEqual({
      repositoryId: run.repositoryId,
      number: issue.number,
    })
  })

  it('TC-126: a subtask relation is mirrored to GitHub as a sub-issue (live)', async () => {
    const apollo = await run.project('TC-126')
    const parent = await run.taskWithIssue(apollo, { title: 'Parent' })
    const child = await run.taskWithIssue(apollo, { title: 'Child' })

    // Step 1: make Child a subtask of Parent.
    await run.tool.call('PUT', `/tasks/${child.task.id}/parent`, { parentId: parent.task.id })

    // Step 2: read the parent issue's sub-issues on GitHub.
    await soon(async () => {
      const subIssues = await run.github.subIssues(parent.issue.number)
      expect(subIssues.map((i) => i.number)).toEqual([child.issue.number])
    })
    // No other sub-issue relation is added on GitHub.
    expect(await run.github.subIssues(child.issue.number)).toEqual([])
  })

  it('TC-127: a blocked-by relation is mirrored to GitHub (live)', async () => {
    const apollo = await run.project('TC-127')
    const a = await run.taskWithIssue(apollo, { title: 'A' })
    const b = await run.taskWithIssue(apollo, { title: 'B' })

    // Step 1: make B blocked by A.
    await run.tool.call('POST', `/tasks/${b.task.id}/blocked-by`, { blockerId: a.task.id })

    // Step 2: read B's issue's blocked-by relations on GitHub.
    await soon(async () => {
      const blockedBy = await run.github.blockedBy(b.issue.number)
      expect(blockedBy.map((i) => i.number)).toEqual([a.issue.number])
    })
    // A's issue is not marked as blocked by B's.
    expect(await run.github.blockedBy(a.issue.number)).toEqual([])
  })

  it('TC-128: assigned people are mirrored to GitHub as assignees (live)', async () => {
    const apollo = await run.project('TC-128')
    const t = await run.taskWithIssue(apollo, { title: 'T' })

    // Step 1: assign alice (the first system admin) to T.
    await run.tool.call('PATCH', `/tasks/${t.task.id}`, { assignees: [run.tool.accountId] })

    // Step 2: the issue's assignees are exactly [tc-alice] (the suite's GitHub user).
    await soon(async () => {
      const issue = await run.github.issue(t.issue.number)
      expect(issue.assignees.map((a) => a.login)).toEqual([login])
    })
  })

  it("TC-129: a milestone's fixed date is mirrored to GitHub (live)", async () => {
    // A milestone's variant cannot change once it is created (FR-194), so M is a fixed-date
    // milestone from the start, and the change pins it to another date.
    const apollo = await run.project('TC-129')
    const m = await run.taskWithIssue(apollo, {
      title: 'M',
      milestone: { variant: 'fixed-date', date: '2027-03-05' },
    })

    // Step 1: pin M to the fixed date 2027-03-12.
    await run.tool.call('PATCH', `/tasks/${m.task.id}`, {
      milestone: { variant: 'fixed-date', date: '2027-03-12' },
    })

    // Step 2: the issue carries 2027-03-12, as the due date of its GitHub milestone.
    await soon(async () => {
      const issue = await run.github.issue(m.issue.number)
      expect(issue.milestone?.due_on).toMatch(/^2027-03-12T/)
    })
  })

  it('TC-193: cancelling a task closes its GitHub issue as not planned (live)', async () => {
    const apollo = await run.project('TC-193')
    const t = await run.taskWithIssue(apollo, { title: 'T' })
    expect(t.issue.state).toBe('open')

    // Step 1: cancel T in the tool.
    await run.tool.call('POST', `/tasks/${t.task.id}/cancel`)

    // Step 2: read the issue on GitHub: closed as not planned, not as completed, and not deleted.
    await soon(async () => {
      const issue = await run.github.issue(t.issue.number)
      expect(issue).toMatchObject({ state: 'closed', state_reason: 'not_planned' })
    })
  })
})

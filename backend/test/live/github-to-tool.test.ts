import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { GitHub, StatusField } from './github.ts'
import { LiveRun } from './run.ts'
import { eventually, today } from './settings.ts'
import type { Task } from './tool.ts'

// The GitHub steps of the test cases on changes made on GitHub (SC-023, SC-024, SC-062, SC-105),
// run against the test deployment and the real test repository (SC-126, DD-062). A change to an
// issue reaches the deployment through the test repository's webhook; a change to the Projects
// status field only at its next re-check, since GitHub sends no webhook for a user's Project. Each
// test waits for the change to arrive, and the tests run side by side to wait together. The
// suite's GitHub user stands for the test cases' `tc-writer`.

let run: LiveRun
let status: StatusField
let login: string

beforeAll(async () => {
  run = await LiveRun.start()
  status = await StatusField.find(
    new GitHub(run.settings, run.settings.projectsToken),
    run.settings,
  )
  login = await run.github.login()
  await run.tool.call('PUT', `/accounts/${run.tool.accountId}/github`, { githubLogin: login })
})

afterAll(async () => {
  await run?.cleanUp()
})

/** Waits for a change made on GitHub to reach the deployment, by the webhook or the re-check. */
const afterRecheck = <T>(check: () => Promise<T>) => eventually(check, run.settings.waitMs)

describe.concurrent('changes made on GitHub reaching the tool, live', () => {
  it('TC-131: starting an issue on GitHub starts its task (live)', async () => {
    const apollo = await run.project('TC-131')
    const t = await run.taskWithIssue(apollo, { title: 'T' })

    // Step 1: set the issue's status field in the GitHub Project to the value for started.
    await status.set(t.issue, 'started')

    // Step 2: read T through the REST API: in progress, started today.
    const task = await afterRecheck(async () => {
      const read = await run.tool.task(t.task.id)
      expect(read.status).toBe('in-progress')
      return read
    })
    expect(task.actualStart).toBe(today(run.settings.timeZone))
    // No revert is made on the issue, and no comment is added to it.
    expect(await run.github.issue(t.issue.number)).toMatchObject({ state: 'open' })
    expect(await run.github.comments(t.issue.number)).toEqual([])
  })

  it('TC-132: putting an issue on hold on GitHub puts its task on hold (live)', async () => {
    const apollo = await run.project('TC-132')
    const t = await run.taskWithIssue(apollo, {
      title: 'T',
      plannedStart: '2027-03-01',
      plannedFinish: '2027-03-05',
    })
    await run.tool.call('PUT', `/tasks/${t.task.id}/status`, { status: 'in-progress' })

    // Step 1: set the issue's status field to the value for on hold.
    await status.set(t.issue, 'onHold')

    // Step 2: read T through the REST API.
    await afterRecheck(async () => {
      expect((await run.tool.task(t.task.id)).status).toBe('on-hold')
    })
  })

  it('TC-133 and TC-135: closing an issue on GitHub finishes its task, and reopening it sets the task back to in progress (live)', async () => {
    const apollo = await run.project('TC-133')
    const t = await run.taskWithIssue(apollo, { title: 'T' })
    await run.tool.call('PUT', `/tasks/${t.task.id}/status`, { status: 'in-progress' })

    // TC-133 step 1: close the issue as completed. Step 2: T is done, finished today.
    await run.github.editIssue(t.issue.number, { state: 'closed', state_reason: 'completed' })
    const done = await afterRecheck(async () => {
      const read = await run.tool.task(t.task.id)
      expect(read.status).toBe('done')
      return read
    })
    expect(done.actualFinish).toBe(today(run.settings.timeZone))

    // TC-135, whose input is TC-133's outcome: T done, its issue closed. Step 1: reopen the issue.
    // Step 2: T is in progress again, with no actual finish.
    await run.github.editIssue(t.issue.number, { state: 'open' })
    const reopened = await afterRecheck(async () => {
      const read = await run.tool.task(t.task.id)
      expect(read.status).toBe('in-progress')
      return read
    })
    expect(reopened.actualFinish).toBeNull()
  })

  it("TC-137 and TC-144: closing a blocked task's issue on GitHub is reopened, with a comment explaining why (live)", async () => {
    const apollo = await run.project('TC-137')
    const a = await run.taskWithIssue(apollo, { title: 'A' })
    const b = await run.taskWithIssue(apollo, { title: 'B' })
    await run.tool.call('PUT', `/tasks/${a.task.id}/status`, { status: 'in-progress' })
    await run.tool.call('POST', `/tasks/${b.task.id}/blocked-by`, { blockerId: a.task.id })
    expect(await run.github.comments(b.issue.number)).toEqual([])

    // Step 1: close B's issue as completed.
    await run.github.editIssue(b.issue.number, { state: 'closed', state_reason: 'completed' })

    // Step 2 (TC-137): B's issue is open again, and B is not done.
    await afterRecheck(async () => {
      expect((await run.github.issue(b.issue.number)).state).toBe('open')
    })
    const task = await run.tool.task(b.task.id)
    expect(task.status).not.toBe('done')
    expect(task.actualFinish).toBeNull()

    // TC-144: B's issue has one new comment, by the tool's App, naming the blocker's issue.
    const comments = await run.github.comments(b.issue.number)
    expect(comments).toHaveLength(1)
    expect(comments[0]!.user.type).toBe('Bot')
    expect(comments[0]!.body).toContain(`#${a.issue.number}`)
    // No comment is posted on A's issue.
    expect(await run.github.comments(a.issue.number)).toEqual([])
  })

  it('TC-141: an assignee change made on GitHub is undone (live)', async () => {
    const apollo = await run.project('TC-141')
    const t = await run.taskWithIssue(apollo, {
      title: 'T',
      assignees: [run.tool.accountId],
    })
    await afterRecheck(async () => {
      const issue = await run.github.issue(t.issue.number)
      expect(issue.assignees.map((a) => a.login)).toEqual([login])
    })

    // Step 1: change the issue's assignees on GitHub. The suite has one GitHub user, who stands
    // for both tc-alice and tc-writer, so the change takes tc-alice off rather than replacing her.
    await run.github.editIssue(t.issue.number, { assignees: [] })

    // Step 2: the issue's assignees are [tc-alice] again; T's assigned people are unchanged.
    await afterRecheck(async () => {
      const issue = await run.github.issue(t.issue.number)
      expect(issue.assignees.map((a) => a.login)).toEqual([login])
    })
    expect((await run.tool.task(t.task.id)).assignees).toEqual([run.tool.accountId])
  })

  it('TC-147: a new issue opened on GitHub becomes an unscheduled task (live)', async () => {
    const apollo = await run.project('TC-147')

    // Step 1: as tc-writer, open an issue in the test repository. Every project of this run
    // pulling from it gets a task for it; all are this run's, and the issue is deleted at the end.
    const opened = await run.openIssue('Crash on start')

    // Step 2: list the tasks of Apollo: one is linked to the issue, with no planned dates.
    const task = await afterRecheck(async () => {
      const tasks = await run.tool.call<Task[]>('GET', `/projects/${apollo}/tasks`)
      const linked = tasks.find(
        (t) =>
          t.githubIssue?.repositoryId === run.repositoryId &&
          t.githubIssue.number === opened.number,
      )
      if (!linked) throw new Error(`Apollo has no task linked to #${opened.number} yet`)
      return linked
    })
    // It has no planned start, planned finish or assigned people.
    expect(task).toMatchObject({ plannedStart: null, plannedFinish: null, assignees: [] })
  })
})

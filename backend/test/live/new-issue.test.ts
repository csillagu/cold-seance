import { afterAll, beforeAll, expect, it } from 'vitest'
import { LiveRun } from './run.ts'
import { eventually } from './settings.ts'
import type { Task } from './tool.ts'

// The GitHub step of the test case on a new issue opened on GitHub (SC-023, SC-105, SC-024), run
// against the test deployment, where the issue arrives by the webhook, and against a server the run
// starts, where it arrives at the re-check (FR-214), and the real test repository (SC-126, SC-128,
// DD-062, DD-063). It runs in a file of its own:
// a new issue goes to the one project that pulls from its repository, and to none while several
// do (FR-100, FR-157), so no other project of the run may pull from the test repository meanwhile.
// The suite's GitHub user stands for the test case's `tc-writer`.

let run: LiveRun

beforeAll(async () => {
  run = await LiveRun.start()
})

afterAll(async () => {
  await run?.cleanUp()
})

/** Waits for the new issue to reach the deployment, by the webhook or the re-check. */
const afterRecheck = <T>(check: () => Promise<T>) => eventually(check, run.settings.waitMs)

it('TC-147: a new issue opened on GitHub becomes an unscheduled task (live)', async () => {
  const apollo = await run.project('TC-147')

  // Step 1: as tc-writer, open an issue in the test repository. Apollo is the only project that
  // pulls from it, so the issue goes to Apollo; it is deleted at the clean-up.
  const opened = await run.openIssue('Crash on start')

  // Step 2: list the tasks of Apollo: one is linked to the issue, with no planned dates.
  const task = await afterRecheck(async () => {
    const tasks = await run.tool.call<Task[]>('GET', `/projects/${apollo}/tasks`)
    const linked = tasks.find(
      (t) =>
        t.githubIssue?.repositoryId === run.repositoryId && t.githubIssue.number === opened.number,
    )
    if (!linked) throw new Error(`Apollo has no task linked to #${opened.number} yet`)
    return linked
  })
  // It has no planned start, planned finish or assigned people.
  expect(task).toMatchObject({ plannedStart: null, plannedFinish: null, assignees: [] })
})

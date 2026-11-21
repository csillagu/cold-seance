import { afterAll, beforeAll, expect, it } from 'vitest'
import { LiveRun } from './run.ts'
import { eventually } from './settings.ts'

// The GitHub step of the seeding test case (SC-025), run against the test deployment and the real
// test repository (SC-126, DD-062). The repository may hold other issues, of this run's other
// files or of earlier runs, so the test looks only at the issue it opens.

let run: LiveRun

beforeAll(async () => {
  run = await LiveRun.start()
})

afterAll(async () => {
  await run?.cleanUp()
})

it('TC-151: seeding imports an open issue as an unscheduled task (live)', async () => {
  const opened = await run.openIssue('Open work')
  // The seeding reads the repository's list of issues, which shows a new issue only after some
  // seconds. Waiting for it before the project pulls from the repository also keeps the issue's
  // webhook from making it a task of the project first.
  await eventually(() => run.github.listed(opened.number), 60_000, 3_000)
  const apollo = await run.project('TC-151')

  // Step 1: seed Apollo from the test repository. The tool reads the list with its App, whose
  // view of the list can lag the suite's token's by some seconds, so the seeding is repeated until
  // the list it read holds the opened issue; a repeat skips what an earlier one brought in.
  const seeded = await eventually(
    async () => {
      const result = await run.tool.call<{
        imported: { taskId: string; repositoryId: string; issueNumber: number }[]
        skipped: { repositoryId: string; issueNumber: number; reason: string }[]
      }>('POST', `/projects/${apollo}/seeding`, { repositoryIds: [run.repositoryId] })
      // Every issue it brought in is now linked to a task of this run's: deleted at the clean-up.
      for (const imported of result.imported) run.track(imported.issueNumber)
      if (![...result.imported, ...result.skipped].some((i) => i.issueNumber === opened.number)) {
        throw new Error(
          `The seeding read no issue #${opened.number} yet (imported ${result.imported.length}, skipped ${result.skipped.length})`,
        )
      }
      return result
    },
    60_000,
    5_000,
  )

  // Step 2: read the task linked to the opened issue: unscheduled, and neither done, cancelled
  // nor in progress.
  const linked = seeded.imported.find((i) => i.issueNumber === opened.number)
  expect(
    linked,
    `skipped as ${seeded.skipped.find((s) => s.issueNumber === opened.number)?.reason}`,
  ).toBeDefined()
  const task = await run.tool.task(linked!.taskId)
  expect(task).toMatchObject({
    projectId: apollo,
    githubIssue: { repositoryId: run.repositoryId, number: opened.number },
    plannedStart: null,
    plannedFinish: null,
    status: 'not-started',
  })
})

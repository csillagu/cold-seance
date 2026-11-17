import { afterAll, beforeAll, expect, it } from 'vitest'
import { LiveRun } from './run.ts'

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
  const apollo = await run.project('TC-151')

  // Step 1: seed Apollo from the test repository.
  const seeded = await run.tool.call<{
    imported: { taskId: string; repositoryId: string; issueNumber: number }[]
  }>('POST', `/projects/${apollo}/seeding`, { repositoryIds: [run.repositoryId] })
  // Every issue it brought in is now linked to a task of this run's: deleted at the clean-up.
  for (const imported of seeded.imported) run.track(imported.issueNumber)

  // Step 2: read the task linked to the opened issue: unscheduled, and neither done, cancelled
  // nor in progress.
  const linked = seeded.imported.find((i) => i.issueNumber === opened.number)
  expect(linked).toBeDefined()
  const task = await run.tool.task(linked!.taskId)
  expect(task).toMatchObject({
    projectId: apollo,
    githubIssue: { repositoryId: run.repositoryId, number: opened.number },
    plannedStart: null,
    plannedFinish: null,
    status: 'not-started',
  })
})

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { buildApp } from '../../src/app.ts'
import { gitHubSeedingSource } from '../../src/github/seeding-source.ts'
import type { Caller } from '../../src/service/caller.ts'
import type { RegisteredRepository } from '../../src/service/repositories.ts'
import { createServices, type Services } from '../../src/service/services.ts'
import { localToday } from '../../src/service/task-status.ts'
import { as, seedAccount, testAuthenticator } from '../helpers/accounts.ts'
import { createTestDatabase, type TestDatabase } from '../helpers/database.ts'
import { fakeGitHub, type FakeGitHub } from '../helpers/github.ts'

// The GitHub seeding importer (SC-025) against a real PostgreSQL and a fake GitHub, through the
// REST API. The test cases' "GitHub Project with a status field the tool uses" is a fake Project
// whose field is `Status`, with the options `In Progress` and `On Hold`: the configuration's
// defaults (SRC-252). An issue's "closing date in the GitHub Project" is the date GitHub records it
// was closed (the owner's answer on #116), in the backend's time zone.
//
// Pending: the seeding screen's part of TC-149, TC-150 and TC-202 (SC-095: F27).

type Seeded = Awaited<ReturnType<typeof seedAccount>>

const by = (account: { id: string }): Caller => ({ accountId: account.id, channel: 'ui' })

interface ApiTask {
  id: string
  title: string
  status: string
  plannedStart: string | null
  plannedFinish: string | null
  durationWorkingDays: number | null
  assignees: string[]
  actualStart: string | null
  actualFinish: string | null
  githubIssue: { repositoryId: string; number: number } | null
}

interface SeedAnswer {
  imported: { taskId: string; repositoryId: string; issueNumber: number }[]
  skipped: { repositoryId: string; issueNumber: number; reason: string }[]
}

let n = 0

describe('GitHub seeding importer', () => {
  let x: TestDatabase
  let github: FakeGitHub
  let services: Services
  let app: ReturnType<typeof buildApp>
  let alice: Seeded
  let bob: Seeded

  beforeEach(async () => {
    x = await createTestDatabase()
    github = fakeGitHub()
    services = createServices(x.db, {
      github: github.reach,
      seeding: gitHubSeedingSource(github.client),
    })
    app = buildApp({}, { authenticators: [testAuthenticator], services })
    await seedAccount(x.db, { username: 'root', systemAdmin: true })
    alice = await seedAccount(x.db, { username: 'alice' })
    bob = await seedAccount(x.db, { username: 'bob' })
  })

  afterEach(async () => {
    await app?.close()
    await x?.drop()
  })

  /** A GitHub test repository with the tool's App installed, registered in the tool by `admin`. */
  async function repository(
    base: string,
    admin: Seeded = alice,
  ): Promise<{ repo: RegisteredRepository; full: string }> {
    const full = `csillagu/${base}-${++n}`
    const [owner = '', name = ''] = full.split('/')
    github.createRepository(full)
    const repo = await services.repositories.registerRepository(by(admin), { owner, name })
    return { repo, full }
  }

  /** A project created by `creator`, empty, that pulls issues from the repositories. */
  async function project(name: string, creator: Seeded, repos: RegisteredRepository[]) {
    const created = await services.projects.createProject(by(creator), { name: `${name} ${++n}` })
    for (const repo of repos) {
      const request = await services.projectRepositories.requestRepository(
        by(creator),
        created.id,
        repo.id,
      )
      if (request.state !== 'approved') {
        await services.projectRepositories.approveRequest(by(alice), request.id)
      }
    }
    return created.id
  }

  const seed = (who: Seeded, projectId: string, repositoryIds: string[]) =>
    app.inject({
      method: 'POST',
      url: `/api/projects/${projectId}/seeding`,
      headers: as(who),
      payload: { repositoryIds },
    })

  async function tasksOf(projectId: string, who: Seeded = alice): Promise<ApiTask[]> {
    const response = await app.inject({
      method: 'GET',
      url: `/api/projects/${projectId}/tasks`,
      headers: as(who),
    })
    expect(response.statusCode).toBe(200)
    return response.json<ApiTask[]>()
  }

  async function relationsOf(taskId: string) {
    const response = await app.inject({
      method: 'GET',
      url: `/api/tasks/${taskId}/relations`,
      headers: as(alice),
    })
    expect(response.statusCode).toBe(200)
    return response.json<{ parent: { id: string } | null; blockedBy: { id: string }[] }>()
  }

  const byNumber = (tasks: ApiTask[], number: number) => {
    const task = tasks.find((t) => t.githubIssue?.number === number)
    if (!task) throw new Error(`no task for #${number}`)
    return task
  }

  /** What GitHub holds of a repository's issues, to tell that seeding changed nothing there. */
  const snapshot = (full: string) => JSON.stringify(github.issues.issuesOf(full))

  /** GitHub requests that would change something. */
  const writes = () => github.requests.filter((r) => !r.startsWith('GET ') && !isRead(r))
  const isRead = (r: string) => r === 'POST /graphql' || /^POST \/app\/installations\//.test(r)

  it('TC-149: seeding imports issues with their relations, assignees and status (service and REST)', async () => {
    const linked = await app.inject({
      method: 'PUT',
      url: `/api/accounts/${alice.id}/github`,
      headers: as(alice),
      payload: { githubLogin: 'tc-alice' },
    })
    expect(linked.statusCode).toBe(200)
    const { repo, full } = await repository('tc-seed')
    const one = github.issues.createIssue(full, 'One')
    const two = github.issues.createIssue(full, 'Two')
    const three = github.issues.createIssue(full, 'Three')
    two.parent = one.id
    two.assignees = ['tc-alice']
    github.issues.addToProject(full, 2, { status: 'In Progress' })
    three.blockedBy = [two.id]
    const apollo = await project('Apollo', alice, [repo])
    const before = snapshot(full)
    const sent = writes().length

    const response = await seed(alice, apollo, [repo.id])
    expect(response.statusCode).toBe(200)

    const tasks = await tasksOf(apollo)
    expect(tasks.map((t) => t.githubIssue?.number).sort((a, b) => (a ?? 0) - (b ?? 0))).toEqual([
      1, 2, 3,
    ])
    const t1 = byNumber(tasks, 1)
    const t2 = byNumber(tasks, 2)
    const t3 = byNumber(tasks, 3)
    expect(t2.status).toBe('in-progress')
    expect(t2.assignees).toEqual([alice.id])
    expect((await relationsOf(t2.id)).parent?.id).toBe(t1.id)
    expect((await relationsOf(t3.id)).blockedBy.map((b) => b.id)).toEqual([t2.id])
    // No issue on GitHub is changed by the seeding.
    expect(snapshot(full)).toBe(before)
    expect(writes().length).toBe(sent)
  })

  it('TC-150: seeding from a repository the GitHub App cannot reach is refused (service and REST)', async () => {
    const full = `csillagu/tc-closed-${++n}`
    github.createRepository(full, { installed: false })
    github.issues.createIssue(full, 'Unreachable')
    const apollo = await project('Apollo', alice, [])
    // The repository cannot be registered, so it cannot be offered to the project.
    const [owner = '', name = ''] = full.split('/')
    await expect(
      services.repositories.registerRepository(by(alice), { owner, name }),
    ).rejects.toThrow('The tool cannot reach')

    // A repository the project pulls from that the App has since lost is refused at seeding.
    const { repo, full: lost } = await repository('tc-lost')
    github.issues.createIssue(lost, 'Lost')
    const borealis = await project('Borealis', alice, [repo])
    github.uninstall(lost)
    const refused = await seed(alice, borealis, [repo.id])
    expect(refused.statusCode).toBe(409)
    expect(await tasksOf(apollo)).toEqual([])
    expect(await tasksOf(borealis)).toEqual([])
  })

  it('TC-150: seeding from a repository the project does not pull from is refused', async () => {
    const { repo, full } = await repository('tc-other', bob)
    github.issues.createIssue(full, 'Not ours')
    const apollo = await project('Apollo', alice, [])
    const response = await seed(alice, apollo, [repo.id])
    expect(response.statusCode).toBe(409)
    expect(await tasksOf(apollo)).toEqual([])
  })

  it('TC-202: a seeding import that fails partway brings nothing in (service and REST)', async () => {
    const { repo, full } = await repository('tc-seed')
    for (let i = 1; i <= 50; i++) github.issues.createIssue(full, `Issue ${i}`)
    const apollo = await project('Apollo', alice, [repo])

    // Access is cut off after the import has read a part of the issues.
    github.cutOffAfter(40)
    const failed = await seed(alice, apollo, [repo.id])
    github.restore()
    expect(failed.statusCode).toBe(503)
    expect(failed.json<{ message: string }>().message).toMatch(/failed/)
    expect(await tasksOf(apollo)).toEqual([])

    // None of the 50 is recorded as imported: a later import brings all of them in.
    const again = await seed(alice, apollo, [repo.id])
    expect(again.statusCode).toBe(200)
    expect(again.json<SeedAnswer>().skipped).toEqual([])
    expect(await tasksOf(apollo)).toHaveLength(50)
  })

  it('TC-151: seeding imports an open issue as an unscheduled task', async () => {
    const { repo, full } = await repository('tc-seed')
    github.issues.createIssue(full, 'Open work')
    const apollo = await project('Apollo', alice, [repo])

    expect((await seed(alice, apollo, [repo.id])).statusCode).toBe(200)

    const tasks = await tasksOf(apollo)
    expect(tasks).toHaveLength(1)
    const [task] = tasks
    expect(task?.githubIssue).toEqual({ repositoryId: repo.id, number: 1 })
    expect(task?.title).toBe('Open work')
    expect(task?.plannedStart).toBeNull()
    expect(task?.plannedFinish).toBeNull()
    expect(task?.durationWorkingDays).toBeNull()
    expect(task?.status).toBe('not-started')
  })

  it('TC-152: seeding imports a closed issue as done with its closing date', async () => {
    const { repo, full } = await repository('tc-seed')
    const issue = github.issues.createIssue(full, 'Old work')
    github.issues.addToProject(full, 1, { status: 'Done' })
    issue.state = 'closed'
    issue.stateReason = 'completed'
    // Noon UTC, so that the date is 2026-09-15 in any time zone the tests run in, but the farthest.
    issue.closedAt = '2026-09-15T12:00:00Z'
    const apollo = await project('Apollo', alice, [repo])

    expect((await seed(alice, apollo, [repo.id])).statusCode).toBe(200)

    const [task, ...rest] = await tasksOf(apollo)
    expect(rest).toEqual([])
    expect(task?.githubIssue?.number).toBe(1)
    expect(task?.status).toBe('done')
    expect(task?.actualFinish).toBe(localToday(new Date('2026-09-15T12:00:00Z')))
    // #1 is not reopened.
    expect(github.issues.issue(full, 1).state).toBe('closed')
  })

  it('TC-236: seeding skips an issue that is already a task in another project', async () => {
    const { repo, full } = await repository('tc-seed')
    github.issues.createIssue(full, 'Taken')
    // Borealis holds a task linked to #1: bob seeded it while #1 was the only issue.
    const borealis = await project('Borealis', bob, [repo])
    expect((await seed(bob, borealis, [repo.id])).statusCode).toBe(200)
    const [taken] = await tasksOf(borealis, bob)
    github.issues.createIssue(full, 'Free')
    const apollo = await project('Apollo', alice, [repo])

    const response = await seed(alice, apollo, [repo.id])
    expect(response.statusCode).toBe(200)
    expect(response.json<SeedAnswer>().skipped).toEqual([
      { repositoryId: repo.id, issueNumber: 1, reason: 'in-another-project' },
    ])

    const tasks = await tasksOf(apollo)
    expect(tasks.map((t) => t.githubIssue)).toEqual([{ repositoryId: repo.id, number: 2 }])
    expect(await tasksOf(borealis, bob)).toEqual([taken])
  })

  it('seeding is for the project admins only, skips pull requests and brings in hold and every closed issue', async () => {
    const { repo, full } = await repository('tc-seed')
    github.issues.createIssue(full, 'Held')
    github.issues.addToProject(full, 1, { status: 'On Hold' })
    const dropped = github.issues.createIssue(full, 'Dropped')
    dropped.state = 'closed'
    dropped.stateReason = 'not_planned'
    dropped.closedAt = '2026-09-01T12:00:00Z'
    github.issues.createIssue(full, 'A pull request').pullRequest = true
    // Disagreeing Projects count as neither started nor on hold.
    github.issues.createIssue(full, 'Torn')
    github.issues.addToProject(full, 4, { status: 'In Progress' })
    github.issues.addToProject(full, 4, { status: 'On Hold' })
    const apollo = await project('Apollo', alice, [repo])
    await services.projectRoles.setRole(by(alice), apollo, bob.id, 'read-write')

    expect((await seed(bob, apollo, [repo.id])).statusCode).toBe(403)
    expect((await seed(alice, apollo, [])).statusCode).toBe(400)
    expect((await seed(alice, apollo, [repo.id, repo.id])).statusCode).toBe(400)

    expect((await seed(alice, apollo, [repo.id])).statusCode).toBe(200)
    const tasks = await tasksOf(apollo)
    expect(tasks.map((t) => t.githubIssue?.number).sort((a, b) => (a ?? 0) - (b ?? 0))).toEqual([
      1, 2, 4,
    ])
    expect(byNumber(tasks, 1).status).toBe('on-hold')
    expect(byNumber(tasks, 2).status).toBe('done')
    expect(byNumber(tasks, 2).actualFinish).toBe(localToday(new Date('2026-09-01T12:00:00Z')))
    expect(byNumber(tasks, 4).status).toBe('not-started')
  })

  it('seeding refuses blocked-by relations that form a cycle, bringing nothing in', async () => {
    const { repo, full } = await repository('tc-seed')
    const one = github.issues.createIssue(full, 'One')
    const two = github.issues.createIssue(full, 'Two')
    one.blockedBy = [two.id]
    two.blockedBy = [one.id]
    const apollo = await project('Apollo', alice, [repo])
    expect((await seed(alice, apollo, [repo.id])).statusCode).toBe(409)
    expect(await tasksOf(apollo)).toEqual([])
  })

  it('TC-237: seeding skips an issue an earlier import already brought in', async () => {
    const { repo, full } = await repository('tc-seed')
    github.issues.createIssue(full, 'First')
    const apollo = await project('Apollo', alice, [repo])
    expect((await seed(alice, apollo, [repo.id])).statusCode).toBe(200)
    github.issues.createIssue(full, 'Second')

    const again = await seed(alice, apollo, [repo.id])
    expect(again.statusCode).toBe(200)
    expect(again.json<SeedAnswer>().skipped).toEqual([
      { repositoryId: repo.id, issueNumber: 1, reason: 'already-in-project' },
    ])

    const tasks = await tasksOf(apollo)
    expect(tasks.filter((t) => t.githubIssue?.number === 1)).toHaveLength(1)
    expect(tasks.filter((t) => t.githubIssue?.number === 2)).toHaveLength(1)
    expect(tasks).toHaveLength(2)
  })

  it('TC-238: seeding skips an issue blocked by one outside the chosen repositories', async () => {
    const { repo, full } = await repository('tc-seed')
    const { full: elsewhere } = await repository('tc-elsewhere')
    const outside = github.issues.createIssue(elsewhere, 'Outside')
    github.issues.createIssue(full, 'Free')
    const blocked = github.issues.createIssue(full, 'Blocked')
    blocked.blockedBy = [outside.id]
    const apollo = await project('Apollo', alice, [repo])

    const response = await seed(alice, apollo, [repo.id])
    expect(response.statusCode).toBe(200)
    expect(response.json<SeedAnswer>().skipped).toEqual([
      { repositoryId: repo.id, issueNumber: 2, reason: 'blocked-from-outside' },
    ])

    const tasks = await tasksOf(apollo)
    expect(tasks.map((t) => t.githubIssue)).toEqual([{ repositoryId: repo.id, number: 1 }])
  })
})

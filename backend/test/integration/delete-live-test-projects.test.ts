import { readFile } from 'node:fs/promises'
import { Client } from 'pg'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { buildApp } from '../../src/app.ts'
import {
  issueSubscriptions,
  projectRepositoryRequests,
  repositories,
  repositoryReceivingProjects,
  taskIssues,
} from '../../src/db/schema.ts'
import { createServices } from '../../src/service/services.ts'
import { as, seedAccount, testAuthenticator } from '../helpers/accounts.ts'
import { createTestDatabase, type TestDatabase } from '../helpers/database.ts'

// The demo seeding workflow's deletion of the live tests' projects (SC-131, DD-064), run as the
// workflow runs it, straight on the database: a live test project goes with every row that refers
// to it, and nothing else is touched.

type Account = Awaited<ReturnType<typeof seedAccount>>
type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'

const script = new URL('../../../deploy/demo/delete-live-test-projects.sql', import.meta.url)

describe("the deletion of the live tests' projects", () => {
  let x: TestDatabase
  let app: ReturnType<typeof buildApp>
  let root: Account
  let alice: Account

  beforeEach(async () => {
    x = await createTestDatabase()
    app = buildApp({}, { authenticators: [testAuthenticator], services: createServices(x.db) })
    root = await seedAccount(x.db, { username: 'root', systemAdmin: true })
    alice = await seedAccount(x.db, { username: 'alice' })
  })

  afterEach(async () => {
    await app?.close()
    await x?.drop()
  })

  /** Makes a request as root through the REST API, failing the test if it is refused. */
  const send = async (method: Method, url: string, payload?: object) => {
    const response = await app.inject({
      method,
      url: `/api${url}`,
      headers: as(root, 'rest-api'),
      ...(payload === undefined ? {} : { payload }),
    })
    if (response.statusCode >= 300) throw new Error(`${method} ${url}: ${response.body}`)
    return response
  }

  const ok = async <T>(method: Method, url: string, payload?: object) =>
    (await send(method, url, payload)).json<T>()

  /** A project with what a live run or a person makes in one, all through the REST API. */
  async function project(name: string) {
    const { id } = await ok<{ id: string }>('POST', '/projects', { name })
    await send('POST', `/projects/${id}/members`, { username: 'alice', role: 'read-write' })
    const task = async (fields: object) =>
      (await ok<{ id: string }>('POST', `/projects/${id}/tasks`, fields)).id
    const first = await task({ title: 'First', plannedStart: '2027-03-01', durationWorkingDays: 3 })
    const second = await task({
      title: 'Second',
      plannedStart: '2027-03-08',
      durationWorkingDays: 2,
      assignees: [alice.id],
    })
    const child = await task({ title: 'Child', durationWorkingDays: 1 })
    await send('POST', `/tasks/${second}/blocked-by`, { blockerId: first })
    await send('PUT', `/tasks/${child}/parent`, { parentId: first })
    await send('PUT', `/tasks/${first}/status`, { status: 'in-progress' })
    await send('POST', `/projects/${id}/baselines`, { name: 'Kick-off plan' })
    await send('PATCH', `/tasks/${first}`, { durationWorkingDays: 5 })
    await send('POST', '/saved-views', {
      name: `Open work in ${name}`,
      kind: 'kanban',
      keptIn: 'project',
      projectId: id,
      filter: [],
    })
    await send('PUT', `/subscriptions/projects/${id}`, {})
    await send('POST', '/proposals', {
      groups: [
        {
          changes: [
            {
              kind: 'update-task',
              task: { taskId: first },
              fields: { title: 'Renamed by proposal' },
            },
          ],
        },
      ],
    })
    return { id, tasks: [first, second, child] }
  }

  async function run(sql: (client: Client) => Promise<void>) {
    const client = new Client({ connectionString: x.url })
    await client.connect()
    try {
      await sql(client)
    } finally {
      await client.end()
    }
  }

  const count = async (query: string, values: unknown[]) => {
    let n = -1
    await run(async (client) => {
      n = Number((await client.query<{ n: string }>(query, values)).rows[0]?.n)
    })
    return n
  }

  it('deletes each live test project with everything that refers to it, and nothing else', async () => {
    const live = await project('Seeding live-2026-11-21-10-05-ab12')
    const kept = await project('Billing Revamp')
    // A name that only looks like a run's is kept: the run's tag ends the name.
    const lookalike = await project('Notes on live-2026-11-21-10-05-ab12 runs')

    // The GitHub side of a live run, which needs GitHub to make through the API.
    const [repository] = await x.db
      .insert(repositories)
      .values({ githubId: 42, owner: 'csillagu', name: 'cold-seance-live', registeredBy: root.id })
      .returning({ id: repositories.id })
    if (!repository) throw new Error('no repository')
    await x.db.insert(projectRepositoryRequests).values({
      projectId: live.id,
      repositoryId: repository.id,
      state: 'approved',
      requestedBy: root.id,
      decidedBy: root.id,
      decidedAt: new Date(),
    })
    await x.db
      .insert(repositoryReceivingProjects)
      .values({ repositoryId: repository.id, projectId: live.id })
    await x.db
      .insert(taskIssues)
      .values({ taskId: live.tasks[0]!, repositoryId: repository.id, number: 7, githubId: 700 })
    await x.db.insert(issueSubscriptions).values({ accountId: alice.id, taskId: live.tasks[0]! })

    // A personal Gantt view over the live project and a kept one.
    await send('POST', '/saved-views', {
      name: 'Across both',
      kind: 'gantt',
      keptIn: 'personal',
      projects: [live.id, kept.id],
      filter: [],
    })

    expect(
      await count('select count(*) as n from audit_log where project_id = $1', [live.id]),
    ).toBeGreaterThan(0)

    const sql = await readFile(script, 'utf8')
    await run(async (client) => {
      await client.query(sql)
    })

    const rows = async (table: string, column: string, id: string) =>
      count(`select count(*) as n from ${table} where ${column} = $1`, [id])
    for (const [table, column] of [
      ['projects', 'id'],
      ['tasks', 'project_id'],
      ['project_members', 'project_id'],
      ['baselines', 'project_id'],
      ['saved_views', 'project_id'],
      ['saved_view_projects', 'project_id'],
      ['project_subscriptions', 'project_id'],
      ['proposal_projects', 'project_id'],
      ['audit_log', 'project_id'],
    ] as const) {
      expect(await rows(table, column, live.id), `${table} of the live project`).toBe(0)
      expect(await rows(table, column, kept.id), `${table} of the kept project`).toBeGreaterThan(0)
      expect(await rows(table, column, lookalike.id), `${table} of the lookalike`).toBeGreaterThan(
        0,
      )
    }
    expect(await rows('project_repository_requests', 'project_id', live.id)).toBe(0)
    expect(await rows('repository_receiving_projects', 'project_id', live.id)).toBe(0)
    expect(await count('select count(*) as n from task_issues', [])).toBe(0)
    expect(await count('select count(*) as n from issue_subscriptions', [])).toBe(0)
    expect(await count('select count(*) as n from proposals', [])).toBe(2)
    expect(await count('select count(*) as n from repositories', [])).toBe(1)
    expect(await count('select count(*) as n from tasks', [])).toBe(6)

    // The kept projects and the views over them still read, and so do the notifications.
    await send('GET', `/projects/${kept.id}`)
    const views = await ok<{ name: string }[]>('GET', '/saved-views')
    expect(views.map((v) => v.name)).toContain('Across both')
    await send('GET', '/notifications')
  })

  it('does nothing when there is no live test project', async () => {
    const kept = await project('Billing Revamp')
    await run(async (client) => {
      await client.query(await readFile(script, 'utf8'))
    })
    expect(await count('select count(*) as n from tasks where project_id = $1', [kept.id])).toBe(3)
  })
})

import { eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { buildApp } from '../../src/app.ts'
import { auditLog } from '../../src/db/schema.ts'
import { createServices } from '../../src/service/services.ts'
import { as, seedAccount } from '../helpers/accounts.ts'
import { testAuthenticator } from '../helpers/accounts.ts'
import { createTestDatabase, type TestDatabase } from '../helpers/database.ts'
import { grantRole } from '../helpers/projects.ts'

// The test cases of the scheduler (SC-004) through the REST API, each in a fresh test deployment:
// a fresh database, first system admin `root`, and a global calendar with Saturday and Sunday as
// the weekend and no company holidays until a test case gives some.

type Account = Awaited<ReturnType<typeof seedAccount>>
type Method = 'GET' | 'POST' | 'PATCH' | 'PUT'

interface TaskBody {
  id: string
  plannedStart: string | null
  plannedFinish: string | null
  durationWorkingDays: number | null
  assignees: string[]
  milestone: { variant: string; date: string | null } | null
}

describe('test cases of the scheduler through the REST API', () => {
  let x: TestDatabase
  let app: ReturnType<typeof buildApp>
  let root: Account
  let alice: Account
  let bob: Account

  beforeEach(async () => {
    x = await createTestDatabase()
    app = buildApp({}, { authenticators: [testAuthenticator], services: createServices(x.db) })
    root = await seedAccount(x.db, { username: 'root', systemAdmin: true })
    alice = await seedAccount(x.db, { username: 'alice' })
    bob = await seedAccount(x.db, { username: 'bob' })
  })

  afterEach(async () => {
    await app?.close()
    await x?.drop()
  })

  const request = (who: Account, method: Method, url: string, payload?: object) =>
    app.inject({
      method,
      url: `/api${url}`,
      headers: as(who, 'rest-api'),
      ...(payload === undefined ? {} : { payload }),
    })

  const ok = async <T = TaskBody>(who: Account, method: Method, url: string, payload?: object) => {
    const response = await request(who, method, url, payload)
    if (response.statusCode >= 300) throw new Error(`${method} ${url}: ${response.body}`)
    return response.json<T>()
  }

  const project = async (who: Account, name: string) =>
    (await ok<{ id: string }>(who, 'POST', '/projects', { name })).id

  const task = async (who: Account, projectId: string, fields: object) =>
    (await ok(who, 'POST', `/projects/${projectId}/tasks`, fields)).id

  const block = (who: Account, taskId: string, blockerId: string) =>
    ok(who, 'POST', `/tasks/${taskId}/blocked-by`, { blockerId })

  const nest = (who: Account, taskId: string, parentId: string) =>
    ok(who, 'PUT', `/tasks/${taskId}/parent`, { parentId })

  const read = (who: Account, taskId: string) => ok(who, 'GET', `/tasks/${taskId}`)

  const span = async (who: Account, taskId: string) => {
    const { plannedStart, plannedFinish } = await read(who, taskId)
    return [plannedStart, plannedFinish]
  }

  const companyHoliday = (date: string) => ok(root, 'PATCH', '/calendar', { addHolidays: [date] })

  const dayOff = (who: Account, date: string) =>
    ok(who, 'PATCH', `/accounts/${who.id}/calendar`, { addHolidays: [date] })

  const tasksOf = async (who: Account, projectId: string) =>
    ok(who, 'GET', `/projects/${projectId}/tasks`)

  const auditOf = (projectId: string) =>
    x.db.select().from(auditLog).where(eq(auditLog.projectId, projectId)).orderBy(auditLog.id)

  it('TC-008: a blocked task follows its blocker when the blocker moves later', async () => {
    const apollo = await project(alice, 'Apollo')
    const a = await task(alice, apollo, {
      title: 'A',
      plannedStart: '2027-03-01',
      durationWorkingDays: 3,
    })
    const b = await task(alice, apollo, { title: 'B', durationWorkingDays: 2 })
    await block(alice, b, a)
    expect(await span(alice, a)).toEqual(['2027-03-01', '2027-03-03'])
    expect(await span(alice, b)).toEqual(['2027-03-04', '2027-03-05'])

    await ok(alice, 'PATCH', `/tasks/${a}`, { plannedStart: '2027-03-03' })

    expect(await span(alice, a)).toEqual(['2027-03-03', '2027-03-05'])
    // The next working day after Friday 2027-03-05 is Monday 2027-03-08, not the weekend.
    const after = await read(alice, b)
    expect([after.plannedStart, after.plannedFinish]).toEqual(['2027-03-08', '2027-03-09'])
    expect(after.durationWorkingDays).toBe(2)
  })

  it('TC-009: a blocked task follows its blocker when the blocker moves earlier', async () => {
    const apollo = await project(alice, 'Apollo')
    const a = await task(alice, apollo, {
      title: 'A',
      plannedStart: '2027-03-03',
      durationWorkingDays: 3,
    })
    const b = await task(alice, apollo, { title: 'B', durationWorkingDays: 2 })
    await block(alice, b, a)
    expect(await span(alice, b)).toEqual(['2027-03-08', '2027-03-09'])

    await ok(alice, 'PATCH', `/tasks/${a}`, { plannedStart: '2027-03-01' })

    expect(await span(alice, a)).toEqual(['2027-03-01', '2027-03-03'])
    // B does not keep its old start of 2027-03-08.
    expect(await span(alice, b)).toEqual(['2027-03-04', '2027-03-05'])
  })

  it("TC-010: a parent task's dates follow a subtask that moves", async () => {
    const apollo = await project(alice, 'Apollo')
    const p = await task(alice, apollo, { title: 'P' })
    const c1 = await task(alice, apollo, {
      title: 'C1',
      plannedStart: '2027-03-01',
      durationWorkingDays: 3,
    })
    const c2 = await task(alice, apollo, {
      title: 'C2',
      plannedStart: '2027-03-08',
      durationWorkingDays: 3,
    })
    await nest(alice, c1, p)
    await nest(alice, c2, p)
    expect(await span(alice, p)).toEqual(['2027-03-01', '2027-03-10'])

    await ok(alice, 'PATCH', `/tasks/${c2}`, { plannedStart: '2027-03-15' })

    expect(await span(alice, p)).toEqual(['2027-03-01', '2027-03-17'])
    expect(await span(alice, c1)).toEqual(['2027-03-01', '2027-03-03'])
  })

  it("TC-011: every ancestor's dates follow a nested subtask that moves", async () => {
    const apollo = await project(alice, 'Apollo')
    const p = await task(alice, apollo, { title: 'P' })
    const c = await task(alice, apollo, { title: 'C' })
    const g = await task(alice, apollo, {
      title: 'G',
      plannedStart: '2027-03-01',
      durationWorkingDays: 2,
    })
    await nest(alice, c, p)
    await nest(alice, g, c)
    expect(await span(alice, p)).toEqual(['2027-03-01', '2027-03-02'])

    await ok(alice, 'PATCH', `/tasks/${g}`, { plannedStart: '2027-03-08' })

    expect(await span(alice, c)).toEqual(['2027-03-08', '2027-03-09'])
    expect(await span(alice, p)).toEqual(['2027-03-08', '2027-03-09'])
  })

  it("TC-012: scheduling skips an assigned person's day off", async () => {
    await dayOff(alice, '2027-03-09')
    const apollo = await project(alice, 'Apollo')
    const a = await task(alice, apollo, {
      title: 'A',
      plannedStart: '2027-03-04',
      durationWorkingDays: 3,
    })
    const b = await task(alice, apollo, {
      title: 'B',
      assignees: [alice.id],
      durationWorkingDays: 2,
    })
    await block(alice, b, a)

    expect(await span(alice, a)).toEqual(['2027-03-04', '2027-03-08'])
    // Not on 2027-03-09, alice's day off, and no working day on the weekend of 03-06 and 03-07.
    expect(await span(alice, b)).toEqual(['2027-03-10', '2027-03-11'])
  })

  it("TC-013: any one assigned person's day off is forbidden for the task", async () => {
    await dayOff(bob, '2027-03-03')
    const apollo = await project(alice, 'Apollo')
    await grantRole(x.db, bob, apollo, 'read-write')
    const a = await task(alice, apollo, {
      title: 'A',
      plannedStart: '2027-03-01',
      durationWorkingDays: 2,
    })
    const b = await task(alice, apollo, {
      title: 'B',
      assignees: [alice.id, bob.id],
      durationWorkingDays: 1,
    })
    await block(alice, b, a)

    // Not on 2027-03-03, even though alice is free that day.
    expect(await span(alice, b)).toEqual(['2027-03-04', '2027-03-04'])
  })

  it('TC-014: an unassigned task takes its forbidden dates from the global calendar', async () => {
    await companyHoliday('2027-03-03')
    await dayOff(alice, '2027-03-04')
    const apollo = await project(alice, 'Apollo')
    const a = await task(alice, apollo, {
      title: 'A',
      plannedStart: '2027-03-01',
      durationWorkingDays: 2,
    })
    const b = await task(alice, apollo, {
      title: 'B',
      eligibility: alice.id,
      durationWorkingDays: 1,
    })
    await block(alice, b, a)

    // Not on the company holiday, and not pushed past alice's day off: she is only eligible.
    const found = await read(alice, b)
    expect(found.assignees).toEqual([])
    expect([found.plannedStart, found.plannedFinish]).toEqual(['2027-03-04', '2027-03-04'])
  })

  it('TC-015: a company holiday is forbidden for an assigned task', async () => {
    await companyHoliday('2027-03-03')
    const apollo = await project(alice, 'Apollo')
    const a = await task(alice, apollo, {
      title: 'A',
      plannedStart: '2027-03-01',
      durationWorkingDays: 2,
    })
    const b = await task(alice, apollo, {
      title: 'B',
      assignees: [alice.id],
      durationWorkingDays: 1,
    })
    await block(alice, b, a)

    expect(await span(alice, b)).toEqual(['2027-03-04', '2027-03-04'])
  })

  it('TC-016: a weekend day is forbidden for an assigned task', async () => {
    const apollo = await project(alice, 'Apollo')
    const a = await task(alice, apollo, {
      title: 'A',
      plannedStart: '2027-03-03',
      durationWorkingDays: 3,
    })
    const b = await task(alice, apollo, {
      title: 'B',
      assignees: [alice.id],
      durationWorkingDays: 1,
    })
    await block(alice, b, a)

    expect(await span(alice, a)).toEqual(['2027-03-03', '2027-03-05'])
    // Monday, not Saturday 2027-03-06 or Sunday 2027-03-07.
    expect(await span(alice, b)).toEqual(['2027-03-08', '2027-03-08'])
  })

  it("TC-017: moving a task onto an assignee's day off is rejected through the REST API", async () => {
    await dayOff(alice, '2027-03-10')
    const apollo = await project(alice, 'Apollo')
    const t = await task(alice, apollo, {
      title: 'T',
      assignees: [alice.id],
      plannedStart: '2027-03-01',
      durationWorkingDays: 1,
    })

    const change = await request(alice, 'PATCH', `/tasks/${t}`, { plannedStart: '2027-03-10' })

    expect(change.statusCode).toBe(400)
    expect(change.json<{ message: string }>().message).toMatch(/2027-03-10/)
    // T stays on 2027-03-01, not moved to any other date in its place.
    expect(await span(alice, t)).toEqual(['2027-03-01', '2027-03-01'])
    // No audit log entry records a change to T's dates: its creation is the only one.
    const entries = await x.db.select().from(auditLog).where(eq(auditLog.subjectId, t))
    expect(entries.map((entry) => entry.action)).toEqual(['task.created'])
  })

  it('TC-018 (partial): a move onto a company holiday through the UI channel is rejected', async () => {
    // Pending: the move made on the Gantt in the browser, and the UI reporting it, need the Gantt
    // with in-place editing (SC-031, SC-067). What is checked here is the rejection the Gantt's
    // move reaches: the same change through the UI channel of the service layer.
    await companyHoliday('2027-03-10')
    const apollo = await project(alice, 'Apollo')
    const t = await task(alice, apollo, {
      title: 'T',
      plannedStart: '2027-03-01',
      durationWorkingDays: 1,
    })

    const move = await app.inject({
      method: 'PATCH',
      url: `/api/tasks/${t}`,
      headers: as(alice, 'ui'),
      payload: { plannedStart: '2027-03-10' },
    })

    expect(move.statusCode).toBe(400)
    expect(await span(alice, t)).toEqual(['2027-03-01', '2027-03-01'])
  })

  // Pending: TC-019 creates a proposal through the MCP server and approves it (SC-010, SC-048,
  // SC-027). The approval will apply the move through the task service, whose rejection of a
  // forbidden date TC-017 and TC-018 check.

  it('TC-020: scheduling leaves a fixed-date milestone on its date', async () => {
    const apollo = await project(alice, 'Apollo')
    const a = await task(alice, apollo, {
      title: 'A',
      plannedStart: '2027-03-01',
      durationWorkingDays: 5,
    })
    const m = await task(alice, apollo, {
      title: 'M',
      milestone: { variant: 'fixed-date', date: '2027-03-12' },
    })
    await block(alice, m, a)

    await ok(alice, 'PATCH', `/tasks/${a}`, { durationWorkingDays: 15 })

    expect(await span(alice, a)).toEqual(['2027-03-01', '2027-03-19'])
    // Still on 2027-03-12, not on 2027-03-22, and still pinned to a fixed date.
    expect((await read(alice, m)).milestone).toEqual({ variant: 'fixed-date', date: '2027-03-12' })
  })

  it("TC-026: a shared milestone moving in its project leaves a dependent project's plan unchanged", async () => {
    const borealis = await project(bob, 'Borealis')
    await grantRole(x.db, alice, borealis, 'read-only')
    const m = await task(bob, borealis, {
      title: 'M',
      milestone: { variant: 'fixed-date', date: '2027-03-10' },
    })
    const apollo = await project(alice, 'Apollo')
    const t = await task(alice, apollo, {
      title: 'T',
      plannedStart: '2027-03-11',
      durationWorkingDays: 2,
    })
    await block(alice, t, m)
    const before = await tasksOf(alice, apollo)
    const logged = (await auditOf(apollo)).length

    await ok(bob, 'PATCH', `/tasks/${m}`, {
      milestone: { variant: 'fixed-date', date: '2027-03-17' },
    })

    expect(await span(alice, t)).toEqual(['2027-03-11', '2027-03-12'])
    // No field of any task in Apollo changes, and Apollo's audit log records nothing new.
    expect(await tasksOf(alice, apollo)).toEqual(before)
    expect(await auditOf(apollo)).toHaveLength(logged)
  })

  it("TC-027: a shared person's new work in one project leaves another project's plan unchanged", async () => {
    const carol = await seedAccount(x.db, { username: 'carol' })
    await ok(carol, 'PUT', `/accounts/${carol.id}/capacity`, { capacity: 100 })
    const apollo = await project(alice, 'Apollo')
    await grantRole(x.db, carol, apollo, 'contributor')
    const t1 = await task(alice, apollo, {
      title: 'T1',
      assignees: [carol.id],
      aiShare: 0,
      plannedStart: '2027-03-01',
      durationWorkingDays: 5,
    })
    const borealis = await project(bob, 'Borealis')
    await grantRole(x.db, carol, borealis, 'contributor')
    const before = await tasksOf(alice, apollo)

    await task(bob, borealis, {
      title: 'T2',
      assignees: [carol.id],
      aiShare: 0,
      plannedStart: '2027-03-01',
      durationWorkingDays: 5,
    })

    const after = await read(alice, t1)
    expect([after.plannedStart, after.plannedFinish]).toEqual(['2027-03-01', '2027-03-05'])
    expect(after.assignees).toEqual([carol.id])
    expect(await tasksOf(alice, apollo)).toEqual(before)
  })

  it('TC-059: a plan change that overloads someone is accepted and nothing moves', async () => {
    await ok(alice, 'PUT', `/accounts/${alice.id}/capacity`, { capacity: 100 })
    const apollo = await project(alice, 'Apollo')
    const fields = {
      assignees: [alice.id],
      aiShare: 0,
      plannedStart: '2027-03-01',
      durationWorkingDays: 5,
    }
    const t1 = await task(alice, apollo, { title: 'T1', ...fields })

    const change = await request(alice, 'POST', `/projects/${apollo}/tasks`, {
      title: 'T2',
      ...fields,
    })

    expect(change.statusCode).toBe(201)
    const t2 = change.json<{ id: string }>().id
    for (const id of [t1, t2]) {
      const found = await read(alice, id)
      expect([found.plannedStart, found.plannedFinish]).toEqual(['2027-03-01', '2027-03-05'])
      expect(found.assignees).toEqual([alice.id])
    }
  })

  it("TC-213: a task's planned finish is its start plus its duration in working days", async () => {
    await companyHoliday('2027-03-08')
    const apollo = await project(alice, 'Apollo')

    const t = await task(alice, apollo, {
      title: 'T',
      plannedStart: '2027-03-04',
      durationWorkingDays: 4,
    })

    // 03-04, 03-05, 03-09 and 03-10: not 2027-03-07 (calendar days) or 2027-03-09 (holiday counted).
    expect((await read(alice, t)).plannedFinish).toBe('2027-03-10')
  })

  it("TC-216: an assignee without a calendar does not stop the others' calendars applying", async () => {
    await companyHoliday('2027-03-04')
    await dayOff(alice, '2027-03-03')
    const apollo = await project(alice, 'Apollo')
    await grantRole(x.db, bob, apollo, 'read-only')
    const a = await task(alice, apollo, {
      title: 'A',
      plannedStart: '2027-03-01',
      durationWorkingDays: 2,
    })
    const b = await task(alice, apollo, {
      title: 'B',
      assignees: [alice.id, bob.id],
      durationWorkingDays: 1,
    })
    await block(alice, b, a)

    // Not on alice's day off (03-03) or the company holiday (03-04).
    expect(await span(alice, b)).toEqual(['2027-03-05', '2027-03-05'])
  })

  it('TC-218: a day off added later does not move the assigned task', async () => {
    const apollo = await project(alice, 'Apollo')
    const t = await task(alice, apollo, {
      title: 'T',
      assignees: [alice.id],
      plannedStart: '2027-03-01',
      durationWorkingDays: 3,
    })
    expect(await span(alice, t)).toEqual(['2027-03-01', '2027-03-03'])

    await dayOff(alice, '2027-03-02')

    const after = await read(alice, t)
    expect([after.plannedStart, after.plannedFinish]).toEqual(['2027-03-01', '2027-03-03'])
    expect(after.assignees).toEqual([alice.id])
  })

  it('TC-219: an assignment that overloads the new assignee does not move the task', async () => {
    await ok(alice, 'PUT', `/accounts/${alice.id}/capacity`, { capacity: 100 })
    await ok(bob, 'PUT', `/accounts/${bob.id}/capacity`, { capacity: 100 })
    const apollo = await project(alice, 'Apollo')
    await grantRole(x.db, bob, apollo, 'read-only')
    const xTask = await task(alice, apollo, {
      title: 'X',
      assignees: [bob.id],
      aiShare: 0,
      plannedStart: '2027-03-01',
      durationWorkingDays: 5,
    })
    const t = await task(alice, apollo, {
      title: 'T',
      aiShare: 0,
      plannedStart: '2027-03-01',
      durationWorkingDays: 3,
    })

    const change = await request(alice, 'PATCH', `/tasks/${t}`, { assignees: [bob.id] })

    expect(change.statusCode).toBe(200)
    const [readT, readX] = [await read(alice, t), await read(alice, xTask)]
    expect([readT.plannedStart, readT.plannedFinish]).toEqual(['2027-03-01', '2027-03-03'])
    expect([readX.plannedStart, readX.plannedFinish]).toEqual(['2027-03-01', '2027-03-05'])
    expect(readT.assignees).toEqual([bob.id])
    expect(readX.assignees).toEqual([bob.id])
  })

  it("TC-269: a floating milestone lies on its last blocker's finish", async () => {
    const apollo = await project(alice, 'Apollo')
    const a = await task(alice, apollo, {
      title: 'A',
      plannedStart: '2027-03-01',
      durationWorkingDays: 3,
    })
    const b = await task(alice, apollo, {
      title: 'B',
      plannedStart: '2027-03-01',
      durationWorkingDays: 5,
    })
    const c = await task(alice, apollo, { title: 'C' })
    const ready = await task(alice, apollo, { title: 'Ready', milestone: { variant: 'floating' } })
    const later = await task(alice, apollo, { title: 'Later', milestone: { variant: 'floating' } })
    await block(alice, ready, a)
    await block(alice, ready, b)
    await block(alice, later, c)

    // On 2027-03-05, B's finish: not 2027-03-03 (A's) nor 2027-03-08 (the next working day). A
    // milestone has one date and no span.
    const readReady = await read(alice, ready)
    expect(readReady.milestone).toEqual({ variant: 'floating', date: '2027-03-05' })
    expect([readReady.plannedStart, readReady.plannedFinish]).toEqual([null, null])
    expect((await read(alice, later)).milestone).toEqual({ variant: 'floating', date: null })
  })
})

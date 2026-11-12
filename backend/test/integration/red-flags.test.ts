import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { buildApp } from '../../src/app.ts'
import { redFlags } from '../../src/db/schema.ts'
import type { DayLoad, PersonLoad } from '../../src/service/daily-person-load.ts'
import { refreshRedFlags } from '../../src/service/red-flags.ts'
import { createServices } from '../../src/service/services.ts'
import { as, seedAccount, testAuthenticator } from '../helpers/accounts.ts'
import { createTestDatabase, type TestDatabase } from '../helpers/database.ts'
import { grantRole, seedProject } from '../helpers/projects.ts'

// The overload detector (SC-040), the assignee availability flag detector (SC-042) and the red
// flag register (SC-043) against a real PostgreSQL, through the REST API: the rules of the
// register first, then the service and REST parts of the test cases of FR-020, FR-021, FR-032,
// FR-042 and FR-043. What the Gantt and the person load view show of them is the frontend's
// (SC-031, SC-032), pending there.

type Seeded = Awaited<ReturnType<typeof seedAccount>>

/** A red flag as the REST API sends it. */
interface Flag {
  id: string
  kind: string
  projectId: string
  raisedAt: string
  accountId?: string
  date?: string
  task?: { id: string; projectId: string }
  overloads?: { accountId: string; date: string }[]
  holiday?: boolean
  blocker?: { id: string; projectId: string }
  crossProject?: boolean
}

interface TaskDates {
  plannedStart: string | null
  plannedFinish: string | null
}

const onDay = (load: PersonLoad, date: string): DayLoad => {
  const day = load.days.find((d) => d.date === date)
  if (!day) throw new Error(`no entry for ${date}`)
  return day
}

let x: TestDatabase
let app: ReturnType<typeof buildApp>
let alice: Seeded

beforeEach(async () => {
  // A fresh test deployment for each test case: empty database and the first system admin root,
  // with the default global calendar of Saturday and Sunday as the weekend and no holidays.
  x = await createTestDatabase()
  app = buildApp({}, { authenticators: [testAuthenticator], services: createServices(x.db) })
  await seedAccount(x.db, { username: 'root', systemAdmin: true })
  alice = await seedAccount(x.db, { username: 'alice' })
})

afterEach(async () => {
  await app.close()
  await x.drop()
})

const api = async (
  account: Seeded,
  method: 'GET' | 'POST' | 'PATCH' | 'PUT',
  url: string,
  payload?: object,
) => app.inject({ method, url, headers: as(account, 'rest-api'), ...(payload && { payload }) })

const createTask = async (owner: Seeded, projectId: string, task: object) => {
  const created = await api(owner, 'POST', `/api/projects/${projectId}/tasks`, task)
  expect(created.statusCode).toBe(201)
  return created.json<{ id: string }>().id
}

const change = async (owner: Seeded, taskId: string, changes: object) => {
  const changed = await api(owner, 'PATCH', `/api/tasks/${taskId}`, changes)
  expect(changed.statusCode).toBe(200)
}

const setCapacity = async (person: Seeded, capacity: number) => {
  const set = await api(person, 'PUT', `/api/accounts/${person.id}/capacity`, { capacity })
  expect(set.statusCode).toBe(200)
}

const flagsOf = async (viewer: Seeded, projectId: string) => {
  const response = await api(viewer, 'GET', `/api/projects/${projectId}/red-flags`)
  expect(response.statusCode).toBe(200)
  return response.json<Flag[]>()
}

const byText = (a: string | undefined, b: string | undefined) => String(a).localeCompare(String(b))
const byFirst = (a: unknown[], b: unknown[]) => String(a[0]).localeCompare(String(b[0]))

/** The tasks shown in red in the project, those with an `assignee-unavailable` flag, sorted. */
const redTasks = async (viewer: Seeded, projectId: string) =>
  (await flagsOf(viewer, projectId))
    .filter((flag) => flag.kind === 'assignee-unavailable')
    .map((flag) => flag.task?.id)
    .sort(byText)

const readLoad = async (viewer: Seeded, person: Seeded, from: string, to: string) => {
  const response = await api(viewer, 'GET', `/api/accounts/${person.id}/load?from=${from}&to=${to}`)
  expect(response.statusCode).toBe(200)
  return response.json<PersonLoad>()
}

const datesOf = async (viewer: Seeded, taskId: string): Promise<TaskDates> => {
  const read = await api(viewer, 'GET', `/api/tasks/${taskId}`)
  expect(read.statusCode).toBe(200)
  const { plannedStart, plannedFinish } = read.json<TaskDates>()
  return { plannedStart, plannedFinish }
}

describe('the red flag register (SC-043)', () => {
  it('records when a flag appears and keeps that time while the flag stays raised', async () => {
    const apollo = await seedProject(x.db, alice, 'Apollo')
    const task = { assignees: [alice.id], aiShare: 0, durationWorkingDays: 1 }
    await createTask(alice, apollo, { title: 'T1', ...task, plannedStart: '2027-03-01' })
    expect(await flagsOf(alice, apollo)).toEqual([])
    await createTask(alice, apollo, { title: 'T2', ...task, plannedStart: '2027-03-01' })
    const raised = await flagsOf(alice, apollo)
    const overload = raised.find((flag) => flag.kind === 'overload')
    expect(overload).toMatchObject({ accountId: alice.id, date: '2027-03-01', projectId: apollo })

    // A third task on the same day changes the overload's detail but not the flag.
    await createTask(alice, apollo, { title: 'T3', ...task, plannedStart: '2027-03-01' })
    const still = await flagsOf(alice, apollo)
    expect(still.find((flag) => flag.kind === 'overload')).toEqual(overload)
    expect(still.filter((flag) => flag.kind === 'assignee-unavailable')).toHaveLength(3)
  })

  it('refuses the flags of a project to someone with no role in it, as not visible', async () => {
    const bob = await seedAccount(x.db, { username: 'bob' })
    const apollo = await seedProject(x.db, alice, 'Apollo')
    const response = await api(bob, 'GET', `/api/projects/${apollo}/red-flags`)
    expect(response.statusCode).toBe(403)
  })

  it('marks overloaded a person whose absence leaves them a capacity of 0 (FR-151)', async () => {
    const apollo = await seedProject(x.db, alice, 'Apollo')
    const t = await createTask(alice, apollo, {
      title: 'T',
      assignees: [alice.id],
      aiShare: 90,
      plannedStart: '2027-03-01',
      durationWorkingDays: 3,
    })
    expect(await flagsOf(alice, apollo)).toEqual([])
    const absence = await api(alice, 'POST', `/api/accounts/${alice.id}/absences`, {
      from: '2027-03-02',
      to: '2027-03-02',
    })
    expect(absence.statusCode).toBe(201)
    const flags = await flagsOf(alice, apollo)
    expect(flags.map((flag) => [flag.kind, flag.date ?? flag.task?.id]).sort(byFirst)).toEqual([
      ['assignee-unavailable', t],
      ['overload', '2027-03-02'],
    ])
  })

  it('raises an overload again when a capacity is lowered, and clears it when raised', async () => {
    const apollo = await seedProject(x.db, alice, 'Apollo')
    await createTask(alice, apollo, {
      title: 'T',
      assignees: [alice.id],
      aiShare: 0,
      plannedStart: '2027-03-01',
      durationWorkingDays: 1,
    })
    await setCapacity(alice, 50)
    expect((await flagsOf(alice, apollo)).map((flag) => flag.kind)).toContain('overload')
    await setCapacity(alice, 100)
    expect(await flagsOf(alice, apollo)).toEqual([])
  })

  it('leaves a task scheduled around a day off as it is, and makes it red if the day off moves into it', async () => {
    const apollo = await seedProject(x.db, alice, 'Apollo')
    const calendar = await api(alice, 'PATCH', `/api/accounts/${alice.id}/calendar`, {
      addHolidays: ['2027-03-02'],
    })
    expect(calendar.statusCode).toBe(200)
    const t = await createTask(alice, apollo, {
      title: 'T',
      assignees: [alice.id],
      plannedStart: '2027-03-01',
      durationWorkingDays: 3,
    })
    // Scheduled around the day off: Monday, Wednesday and Thursday.
    expect(await datesOf(alice, t)).toEqual({
      plannedStart: '2027-03-01',
      plannedFinish: '2027-03-04',
    })
    expect(await redTasks(alice, apollo)).toEqual([])

    await api(alice, 'PATCH', `/api/accounts/${alice.id}/calendar`, {
      addHolidays: ['2027-03-03'],
    })
    expect(await redTasks(alice, apollo)).toEqual([t])
    expect(await datesOf(alice, t)).toEqual({
      plannedStart: '2027-03-01',
      plannedFinish: '2027-03-04',
    })
  })

  it('gives a violation across a project boundary only to a caller who can read both projects', async () => {
    const bob = await seedAccount(x.db, { username: 'bob' })
    const dave = await seedAccount(x.db, { username: 'dave' })
    const apollo = await seedProject(x.db, alice, 'Apollo')
    const borealis = await seedProject(x.db, bob, 'Borealis')
    await grantRole(x.db, alice, borealis, 'read-only')
    await grantRole(x.db, bob, apollo, 'read-only')
    // dave reads Apollo but not Borealis.
    await grantRole(x.db, dave, apollo, 'read-only')
    const m = await createTask(bob, borealis, {
      title: 'M',
      milestone: { variant: 'fixed-date', date: '2027-03-10' },
    })
    const t = await createTask(alice, apollo, {
      title: 'T',
      plannedStart: '2027-03-01',
      durationWorkingDays: 1,
    })
    const added = await api(alice, 'POST', `/api/tasks/${t}/blocked-by`, { blockerId: m })
    expect(added.statusCode).toBeLessThan(300)

    const seenByAlice = await flagsOf(alice, apollo)
    expect(seenByAlice).toMatchObject([
      {
        kind: 'cross-project-dependency',
        task: { id: t, projectId: apollo },
        blocker: { id: m, projectId: borealis },
        crossProject: true,
      },
    ])
    expect((await flagsOf(bob, borealis)).map((flag) => flag.kind)).toEqual([
      'cross-project-dependency',
    ])
    expect(await flagsOf(dave, apollo)).toEqual([])
  })

  it('takes in, when refreshed, a plan written without it', async () => {
    const apollo = await seedProject(x.db, alice, 'Apollo')
    const task = { assignees: [alice.id], aiShare: 0, durationWorkingDays: 1 }
    await createTask(alice, apollo, { title: 'T1', ...task, plannedStart: '2027-03-01' })
    await createTask(alice, apollo, { title: 'T2', ...task, plannedStart: '2027-03-01' })
    await x.db.delete(redFlags)
    expect(await flagsOf(alice, apollo)).toEqual([])
    await x.db.transaction(refreshRedFlags)
    expect(await flagsOf(alice, apollo)).toHaveLength(3)
  })

  it("does not check a parent, whose dates are its subtasks', for holidays (FR-006)", async () => {
    const apollo = await seedProject(x.db, alice, 'Apollo')
    const parent = await createTask(alice, apollo, {
      title: 'P',
      assignees: [alice.id],
      plannedStart: '2027-03-01',
      durationWorkingDays: 3,
    })
    const sub = await createTask(alice, apollo, {
      title: 'S',
      plannedStart: '2027-03-01',
      durationWorkingDays: 1,
    })
    const set = await api(alice, 'PUT', `/api/tasks/${sub}/parent`, { parentId: parent })
    expect(set.statusCode).toBe(200)
    // The parent now spans its one subtask's day, though its duration still reads 3.
    expect(await datesOf(alice, parent)).toEqual({
      plannedStart: '2027-03-01',
      plannedFinish: '2027-03-01',
    })
    expect(await redTasks(alice, apollo)).toEqual([])
  })
})

describe('TC-056: a person is marked overloaded on a day their load exceeds their capacity', () => {
  // Pending: the person load view showing it in red is the person load chart's (SC-032).
  it('marks alice overloaded on 2027-03-01 and 2027-03-02 only', async () => {
    await setCapacity(alice, 80)
    const apollo = await seedProject(x.db, alice, 'Apollo')
    await createTask(alice, apollo, {
      title: 'T',
      assignees: [alice.id],
      aiShare: 0,
      plannedStart: '2027-03-01',
      durationWorkingDays: 2,
    })

    const load = await readLoad(alice, alice, '2027-03-01', '2027-03-05')

    expect(load.days.map((day) => [day.date, day.overloaded])).toEqual([
      ['2027-03-01', true],
      ['2027-03-02', true],
      ['2027-03-03', false],
      ['2027-03-04', false],
      ['2027-03-05', false],
    ])
    const overloads = (await flagsOf(alice, apollo)).filter((flag) => flag.kind === 'overload')
    expect(overloads.map((flag) => [flag.accountId, flag.date])).toEqual([
      [alice.id, '2027-03-01'],
      [alice.id, '2027-03-02'],
    ])
  })
})

describe('TC-057: a load equal to capacity is not an overload', () => {
  // Pending: the person load view showing it is the person load chart's (SC-032).
  it("shows alice's load of 80% on 2027-03-01, not overloaded and not red", async () => {
    await setCapacity(alice, 80)
    const apollo = await seedProject(x.db, alice, 'Apollo')
    await createTask(alice, apollo, {
      title: 'T',
      assignees: [alice.id],
      aiShare: 20,
      plannedStart: '2027-03-01',
      durationWorkingDays: 1,
    })

    const day = onDay(await readLoad(alice, alice, '2027-03-01', '2027-03-01'), '2027-03-01')

    expect(day.load).toBe(80)
    expect(day.capacity).toBe(80)
    expect(day.overloaded).toBe(false)
    expect(await flagsOf(alice, apollo)).toEqual([])
  })
})

describe('TC-029: a task turns red when an assigned person is overloaded during it', () => {
  // T1 and T2 shown in red on the Gantt is the Gantt timeline's (SC-031), in e2e/tests/gantt.spec.ts.
  it('makes T1 and T2 red once T2 puts alice at 200% on 2027-03-03, moving neither', async () => {
    const apollo = await seedProject(x.db, alice, 'Apollo')
    const t1 = await createTask(alice, apollo, {
      title: 'T1',
      assignees: [alice.id],
      aiShare: 0,
      plannedStart: '2027-03-01',
      durationWorkingDays: 3,
    })
    const t2 = await createTask(alice, apollo, {
      title: 'T2',
      assignees: [alice.id],
      aiShare: 0,
    })
    expect(await redTasks(alice, apollo)).toEqual([])

    await change(alice, t2, { plannedStart: '2027-03-03', durationWorkingDays: 1 })

    expect(await redTasks(alice, apollo)).toEqual([t1, t2].sort(byText))
    expect(await datesOf(alice, t1)).toEqual({
      plannedStart: '2027-03-01',
      plannedFinish: '2027-03-03',
    })
    expect(await datesOf(alice, t2)).toEqual({
      plannedStart: '2027-03-03',
      plannedFinish: '2027-03-03',
    })
  })
})

describe('TC-030: a task turns red when an assigned person takes a day off during it', () => {
  // T shown in red on the Gantt is the Gantt timeline's (SC-031), in e2e/tests/gantt.spec.ts.
  it('makes T red once alice takes 2027-03-02 off, with T still running 2027-03-01 to 2027-03-03', async () => {
    const apollo = await seedProject(x.db, alice, 'Apollo')
    const t = await createTask(alice, apollo, {
      title: 'T',
      assignees: [alice.id],
      plannedStart: '2027-03-01',
      durationWorkingDays: 3,
    })
    expect(await redTasks(alice, apollo)).toEqual([])

    const dayOff = await api(alice, 'PATCH', `/api/accounts/${alice.id}/calendar`, {
      addHolidays: ['2027-03-02'],
    })
    expect(dayOff.statusCode).toBe(200)

    const flags = await flagsOf(alice, apollo)
    expect(flags).toMatchObject([
      { kind: 'assignee-unavailable', task: { id: t }, overloads: [], holiday: true },
    ])
    expect(await datesOf(alice, t)).toEqual({
      plannedStart: '2027-03-01',
      plannedFinish: '2027-03-03',
    })
  })
})

describe("TC-058: a shared person's overload is red to every project involved", () => {
  // Pending: the person load views of Apollo and Borealis are the person load chart's (SC-032).
  it("shows carol's overload on 2027-03-01 in red in both Apollo and Borealis, moving neither task", async () => {
    const bob = await seedAccount(x.db, { username: 'bob' })
    const carol = await seedAccount(x.db, { username: 'carol' })
    const apollo = await seedProject(x.db, alice, 'Apollo')
    const borealis = await seedProject(x.db, bob, 'Borealis')
    await grantRole(x.db, carol, apollo, 'read-only')
    await grantRole(x.db, carol, borealis, 'read-only')
    const task = {
      assignees: [carol.id],
      aiShare: 0,
      plannedStart: '2027-03-01',
      durationWorkingDays: 1,
    }
    const t1 = await createTask(alice, apollo, { title: 'T1', ...task })
    const t2 = await createTask(bob, borealis, { title: 'T2', ...task })

    for (const [viewer, project] of [
      [alice, apollo],
      [bob, borealis],
    ] as const) {
      const overloads = (await flagsOf(viewer, project)).filter((f) => f.kind === 'overload')
      expect(overloads).toMatchObject([
        { projectId: project, accountId: carol.id, date: '2027-03-01' },
      ])
      const day = onDay(await readLoad(viewer, carol, '2027-03-01', '2027-03-01'), '2027-03-01')
      expect(day.overloaded).toBe(true)
    }
    expect(await redTasks(alice, apollo)).toEqual([t1])
    expect(await redTasks(bob, borealis)).toEqual([t2])

    // Negative: neither task has moved.
    for (const [viewer, t] of [
      [alice, t1],
      [bob, t2],
    ] as const) {
      expect(await datesOf(viewer, t)).toEqual({
        plannedStart: '2027-03-01',
        plannedFinish: '2027-03-01',
      })
    }
  })
})

describe('TC-031: a red overload flag clears once the overload is gone', () => {
  // The Gantt showing T1 and T2 red, then not, is the Gantt timeline's (SC-031), in
  // e2e/tests/gantt.spec.ts.
  it('clears the flags of T1 and T2 once alice is removed from T2 through the REST API', async () => {
    const apollo = await seedProject(x.db, alice, 'Apollo')
    const t1 = await createTask(alice, apollo, {
      title: 'T1',
      assignees: [alice.id],
      aiShare: 0,
      plannedStart: '2027-03-01',
      durationWorkingDays: 3,
    })
    const t2 = await createTask(alice, apollo, {
      title: 'T2',
      assignees: [alice.id],
      aiShare: 0,
      plannedStart: '2027-03-03',
      durationWorkingDays: 1,
    })
    expect(await redTasks(alice, apollo)).toEqual([t1, t2].sort(byText))

    await change(alice, t2, { assignees: [] })

    expect(await flagsOf(alice, apollo)).toEqual([])
    // Negative: no other change was needed, and neither task's dates changed.
    expect(await datesOf(alice, t1)).toEqual({
      plannedStart: '2027-03-01',
      plannedFinish: '2027-03-03',
    })
    expect(await datesOf(alice, t2)).toEqual({
      plannedStart: '2027-03-03',
      plannedFinish: '2027-03-03',
    })
  })
})

describe('TC-044: two 50% AI tasks on the same days fit one full-time person', () => {
  // The rest of the test case, the load each task puts on alice, is in person-load.test.ts.
  // Pending: the person load view is the person load chart's (SC-032).
  it('leaves alice not overloaded on any day of the week, and neither task red', async () => {
    const apollo = await seedProject(x.db, alice, 'Apollo')
    const task = {
      assignees: [alice.id],
      aiShare: 50,
      plannedStart: '2027-03-01',
      durationWorkingDays: 5,
    }
    await createTask(alice, apollo, { title: 'T1', ...task })
    await createTask(alice, apollo, { title: 'T2', ...task })

    const load = await readLoad(alice, alice, '2027-03-01', '2027-03-05')
    expect(load.days.map((day) => [day.load, day.overloaded])).toEqual(
      Array.from({ length: 5 }, () => [100, false]),
    )
    expect(await flagsOf(alice, apollo)).toEqual([])
  })
})

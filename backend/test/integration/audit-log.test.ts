import { randomUUID } from 'node:crypto'
import { eq, sql } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { buildApp } from '../../src/app.ts'
import type { Database } from '../../src/db/client.ts'
import { auditLog } from '../../src/db/schema.ts'
import { AccountService } from '../../src/service/accounts.ts'
import {
  AuditLogService,
  DEFAULT_PAGE_SIZE,
  MAX_PAGE_SIZE,
  type AuditEntry,
  type Change,
} from '../../src/service/audit.ts'
import { CHANNELS, type Caller, type Channel } from '../../src/service/caller.ts'
import { ServiceError } from '../../src/service/errors.ts'
import type { ProjectRole, ProjectRoles } from '../../src/service/project-roles.ts'
import type { Services } from '../../src/service/services.ts'
import { as, seedAccount, testAuthenticator } from '../helpers/accounts.ts'
import { createTestDatabase, type TestDatabase } from '../helpers/database.ts'

// The audit log (SC-013) against a real PostgreSQL: the rules of recording and reading it, then
// the test cases of FR-116, FR-138, FR-139 and FR-164, as far as the parts built so far reach.
//
// The project role store (SC-014) does not exist yet. The tests hand the audit log a table of
// roles in its place, through the same `ProjectRoles` interface the store will fill; projects
// (SC-017) do not exist either, so a project here is only an id.

type Seeded = Awaited<ReturnType<typeof seedAccount>>

const via = (account: Seeded, channel: Channel = 'ui'): Caller => ({
  accountId: account.id,
  channel,
})

/** Project roles from a table, standing in for the project role store (SC-014). */
function roleTable(): ProjectRoles & { grant(a: Seeded, p: string, role: ProjectRole): void } {
  const roles = new Map<string, ProjectRole>()
  return {
    grant: (account, projectId, role) => roles.set(`${account.id}/${projectId}`, role),
    roleOf: async (accountId, projectId) => roles.get(`${accountId}/${projectId}`),
  }
}

/** A change as a module of the service layer would hand it over: here, a task renamed. */
const renamed = (projectId: string, task: string, from: string, to: string): Change => ({
  action: 'task.updated',
  subject: { type: 'task', id: task },
  projectId,
  details: { title: { from, to } },
})

async function refused(promise: Promise<unknown>, kind: ServiceError['kind']) {
  const error = await promise.then(
    () => undefined,
    (e: unknown) => e,
  )
  if (!(error instanceof ServiceError)) {
    throw new Error(`expected a ServiceError, got ${String(error)}`)
  }
  expect(error.kind).toBe(kind)
  return error
}

/** The database's clock, which stamps the entries, so the tests do not depend on the host's. */
async function now(db: Database): Promise<Date> {
  const result = await db.execute<{ now: Date }>(sql`select now() as now`)
  return new Date(result.rows[0]!.now)
}

describe('the audit log service', () => {
  let x: TestDatabase
  let roles: ReturnType<typeof roleTable>
  let audit: AuditLogService
  let root: Seeded
  let alice: Seeded
  let bob: Seeded

  beforeAll(async () => {
    x = await createTestDatabase()
    roles = roleTable()
    audit = new AuditLogService(x.db, roles)
    root = await seedAccount(x.db, { username: 'root', systemAdmin: true })
    alice = await seedAccount(x.db, { username: 'alice' })
    bob = await seedAccount(x.db, { username: 'bob' })
  })

  afterAll(async () => {
    await x?.drop()
  })

  describe('record', () => {
    it('records who made a change, when, through which channel, and what it was', async () => {
      const project = randomUUID()
      const before = await now(x.db)
      await audit.record(x.db, via(alice, 'rest-api'), renamed(project, 'T', 'Draft', 'Final'))
      const after = await now(x.db)

      const [entry] = await audit.readLog(via(root), { projectId: project })
      expect(entry).toEqual({
        id: expect.any(Number),
        at: expect.any(Date),
        by: { accountId: alice.id, username: 'alice' },
        channels: ['rest-api'],
        projectId: project,
        action: 'task.updated',
        subject: { type: 'task', id: 'T' },
        details: { title: { from: 'Draft', to: 'Final' } },
      } satisfies AuditEntry)
      expect(entry!.at.getTime()).toBeGreaterThanOrEqual(before.getTime())
      expect(entry!.at.getTime()).toBeLessThanOrEqual(after.getTime())
    })

    it.each(CHANNELS)('records the %s channel as the channel of a change', async (channel) => {
      const project = randomUUID()
      await audit.record(x.db, via(alice, channel), renamed(project, 'T', 'a', 'b'))
      const entries = await audit.readLog(via(root), { projectId: project })
      expect(entries.map((e) => e.channels)).toEqual([[channel]])
    })

    it('records a change outside any project with no project, and empty details by default', async () => {
      const subject = randomUUID()
      await audit.record(x.db, via(root), {
        action: 'account.created',
        subject: { type: 'account', id: subject },
      })
      const entries = await audit.readLog(via(root))
      const entry = entries.find((e) => e.subject.id === subject)
      expect(entry).toMatchObject({ projectId: null, details: {} })
    })

    it('writes nothing when the transaction the change was made in is rolled back', async () => {
      const project = randomUUID()
      const failure = new Error('the change failed after its entry was written')
      await expect(
        x.db.transaction(async (tx) => {
          await audit.record(tx, via(alice), renamed(project, 'T', 'a', 'b'))
          throw failure
        }),
      ).rejects.toBe(failure)
      expect(await audit.readLog(via(root), { projectId: project })).toEqual([])
    })

    it('cannot record a change by someone who has no account', async () => {
      const nobody = { accountId: randomUUID(), channel: 'ui' } as const
      // PostgreSQL's foreign key violation: the entry must name an account.
      await expect(
        audit.record(x.db, nobody, renamed(randomUUID(), 'T', 'a', 'b')),
      ).rejects.toMatchObject({ cause: { code: '23503' } })
    })

    it('keeps an entry with no channel, or one that is not a channel, out of the log', async () => {
      const row = {
        actorAccountId: alice.id,
        action: 'task.updated',
        subjectType: 'task',
        subjectId: 'T',
      }
      // PostgreSQL's check violation, then its refusal of a value the channel type does not have.
      await expect(x.db.insert(auditLog).values({ ...row, channels: [] })).rejects.toMatchObject({
        cause: { code: '23514', constraint: 'audit_log_channels_not_empty' },
      })
      await expect(
        x.db.execute(
          sql`insert into audit_log (actor_account_id, channels, action, subject_type, subject_id)
              values (${alice.id}, '{email}', 'task.updated', 'task', 'T')`,
        ),
      ).rejects.toMatchObject({ cause: { code: '22P02' } })
    })
  })

  describe('recordApprovedProposalChange', () => {
    it('records the approver as the one who made the change, through both channels', async () => {
      const project = randomUUID()
      await audit.recordApprovedProposalChange(x.db, via(bob, 'ui'), 'mcp', {
        action: 'task.moved',
        subject: { type: 'task', id: 'A' },
        projectId: project,
      })
      const [entry] = await audit.readLog(via(root), { projectId: project })
      expect(entry?.by).toEqual({ accountId: bob.id, username: 'bob' })
      expect(entry?.channels).toEqual(['mcp', 'ui'])
    })

    it('records both channels, in that order, even when they are the same one', async () => {
      const project = randomUUID()
      await audit.recordApprovedProposalChange(x.db, via(bob, 'rest-api'), 'rest-api', {
        action: 'task.moved',
        subject: { type: 'task', id: 'A' },
        projectId: project,
      })
      const [entry] = await audit.readLog(via(root), { projectId: project })
      expect(entry?.channels).toEqual(['rest-api', 'rest-api'])
    })
  })

  describe('readLog', () => {
    it('lets a system admin read the whole log, every project and outside any project', async () => {
      const [p, q] = [randomUUID(), randomUUID()]
      const account = randomUUID()
      await audit.record(x.db, via(alice), renamed(p, 'A', 'a', 'b'))
      await audit.record(x.db, via(bob), renamed(q, 'B', 'a', 'b'))
      await audit.record(x.db, via(root), {
        action: 'account.created',
        subject: { type: 'account', id: account },
      })
      const subjects = (await audit.readLog(via(root))).map((e) => e.subject.id)
      expect(subjects).toEqual(expect.arrayContaining(['A', 'B', account]))
    })

    it("lets a system admin read one project's part, and only that part", async () => {
      const [p, q] = [randomUUID(), randomUUID()]
      await audit.record(x.db, via(alice), renamed(p, 'A', 'a', 'b'))
      await audit.record(x.db, via(bob), renamed(q, 'B', 'a', 'b'))
      const entries = await audit.readLog(via(root), { projectId: p })
      expect(entries.map((e) => e.subject.id)).toEqual(['A'])
    })

    it.each(['admin', 'read-write'] as const)(
      "lets a project's %s read that project's part, and only that part",
      async (role) => {
        const [p, q] = [randomUUID(), randomUUID()]
        const reader = await seedAccount(x.db, { username: `reader-${randomUUID()}` })
        roles.grant(reader, p, role)
        await audit.record(x.db, via(bob), renamed(p, 'A', 'a', 'b'))
        await audit.record(x.db, via(bob), renamed(q, 'B', 'a', 'b'))
        const entries = await audit.readLog(via(reader), { projectId: p })
        expect(entries.map((e) => e.subject.id)).toEqual(['A'])
        await refused(audit.readLog(via(reader), { projectId: q }), 'forbidden')
      },
    )

    it.each(['read-only', 'contributor'] as const)(
      "refuses a project's %s its part of the log",
      async (role) => {
        const p = randomUUID()
        const reader = await seedAccount(x.db, { username: `reader-${randomUUID()}` })
        roles.grant(reader, p, role)
        await audit.record(x.db, via(bob), renamed(p, 'A', 'a', 'b'))
        const error = await refused(audit.readLog(via(reader), { projectId: p }), 'forbidden')
        expect(error.message).toBe(
          "Only system admins and the project's admins and read-write members can read its audit log",
        )
      },
    )

    it('refuses the whole log to everyone but system admins, a project admin included', async () => {
      const p = randomUUID()
      const admin = await seedAccount(x.db, { username: `admin-${randomUUID()}` })
      roles.grant(admin, p, 'admin')
      for (const caller of [via(admin), via(alice)]) {
        const error = await refused(audit.readLog(caller), 'forbidden')
        expect(error.message).toBe('Only system admins can read the whole audit log')
      }
    })

    it('refuses a caller with no account, or an id that is no account id', async () => {
      const p = randomUUID()
      for (const accountId of [randomUUID(), 'root', '']) {
        const whole = await refused(audit.readLog({ accountId, channel: 'ui' }), 'forbidden')
        expect(whole.message).toBe('Only system admins can read the whole audit log')
        const part = await refused(
          audit.readLog({ accountId, channel: 'ui' }, { projectId: p }),
          'forbidden',
        )
        expect(part.message).toMatch(/^Only system admins and the project's admins/)
      }
    })

    it('refuses someone with no role in the project, and asks for no role with an id that is no project id', async () => {
      for (const projectId of [randomUUID(), 'Apollo']) {
        const error = await refused(audit.readLog(via(alice), { projectId }), 'forbidden')
        expect(error.message).toMatch(/^Only system admins and the project's admins/)
      }
    })

    it('refuses someone who may not read before looking at what they asked for', async () => {
      const whole = await refused(audit.readLog(via(alice), { limit: 0 }), 'forbidden')
      expect(whole.message).not.toMatch(/limit/)
      const part = await refused(
        audit.readLog(via(alice), { projectId: 'x', before: -1 }),
        'forbidden',
      )
      expect(part.message).not.toMatch(/project id|before/)
    })

    it('refuses a system admin a project id that is not one', async () => {
      const error = await refused(audit.readLog(via(root), { projectId: 'Apollo' }), 'invalid')
      expect(error.message).toBe('The project id is not valid')
    })

    it('answers an empty log for a project with no entries', async () => {
      expect(await audit.readLog(via(root), { projectId: randomUUID() })).toEqual([])
    })

    it('refuses everyone but system admins while there is no project role store', async () => {
      const p = randomUUID()
      const withoutRoles = new AuditLogService(x.db)
      await refused(withoutRoles.readLog(via(alice), { projectId: p }), 'forbidden')
      expect(await withoutRoles.readLog(via(root), { projectId: p })).toEqual([])
    })
  })

  describe('reading page by page', () => {
    let project: string
    const count = DEFAULT_PAGE_SIZE + 5

    beforeAll(async () => {
      project = randomUUID()
      for (let i = 0; i < count; i++) {
        await audit.record(x.db, via(alice), renamed(project, `T${i}`, 'a', 'b'))
      }
    })

    it(`answers the newest ${DEFAULT_PAGE_SIZE} entries first when no limit is given`, async () => {
      const entries = await audit.readLog(via(root), { projectId: project })
      expect(entries).toHaveLength(DEFAULT_PAGE_SIZE)
      expect(entries[0]?.subject.id).toBe(`T${count - 1}`)
      const ids = entries.map((e) => e.id)
      expect(ids).toEqual([...ids].sort((a, b) => b - a))
    })

    it('answers at most the limit, and the next page from before the last entry', async () => {
      const first = await audit.readLog(via(root), { projectId: project, limit: 3 })
      expect(first.map((e) => e.subject.id)).toEqual([
        `T${count - 1}`,
        `T${count - 2}`,
        `T${count - 3}`,
      ])
      const next = await audit.readLog(via(root), {
        projectId: project,
        limit: 3,
        before: first.at(-1)!.id,
      })
      expect(next.map((e) => e.subject.id)).toEqual([
        `T${count - 4}`,
        `T${count - 5}`,
        `T${count - 6}`,
      ])
    })

    it('reads every entry once when it follows the pages to the end', async () => {
      const seen: string[] = []
      let before: number | undefined
      for (;;) {
        const page = await audit.readLog(via(root), { projectId: project, limit: 40, before })
        if (page.length === 0) break
        seen.push(...page.map((e) => e.subject.id))
        before = page.at(-1)!.id
      }
      expect(seen).toHaveLength(count)
      expect(new Set(seen).size).toBe(count)
    })

    it(`takes a limit of ${MAX_PAGE_SIZE} and refuses a limit outside 1 to ${MAX_PAGE_SIZE}`, async () => {
      await expect(audit.readLog(via(root), { limit: MAX_PAGE_SIZE })).resolves.toBeInstanceOf(
        Array,
      )
      await expect(audit.readLog(via(root), { limit: 1 })).resolves.toHaveLength(1)
      for (const limit of [0, -1, MAX_PAGE_SIZE + 1, 1.5, Number.NaN]) {
        const error = await refused(audit.readLog(via(root), { limit }), 'invalid')
        expect(error.message).toBe(`The limit must be a whole number from 1 to ${MAX_PAGE_SIZE}`)
      }
    })

    it('takes the largest safe whole number as the entry to read before', async () => {
      const page = await audit.readLog(via(root), { before: Number.MAX_SAFE_INTEGER, limit: 1 })
      expect(page).toHaveLength(1)
    })

    it('refuses an entry to read before that is not a positive whole number', async () => {
      for (const before of [0, -3, 2.5, Number.NaN, Number.MAX_SAFE_INTEGER + 1, 1e20]) {
        const error = await refused(audit.readLog(via(root), { before }), 'invalid')
        expect(error.message).toBe('The entry to read before must be a positive whole number')
      }
    })
  })
})

/** An audit log that fails to write any entry. */
class UnavailableAuditLog extends AuditLogService {
  override async record(): Promise<void> {
    throw new Error('the audit log is not available')
  }
}

describe('account administration records its changes (FR-116)', () => {
  let x: TestDatabase
  let audit: AuditLogService
  let accounts: AccountService
  let root: Seeded
  let alice: Seeded

  beforeAll(async () => {
    x = await createTestDatabase()
    audit = new AuditLogService(x.db)
    accounts = new AccountService(x.db, audit)
    root = await seedAccount(x.db, { username: 'root', systemAdmin: true })
    alice = await seedAccount(x.db, { username: 'alice' })
  })

  afterAll(async () => {
    await x?.drop()
  })

  const entriesAbout = async (subjectId: string) =>
    (await audit.readLog(via(root), { limit: MAX_PAGE_SIZE })).filter(
      (e) => e.subject.id === subjectId,
    )

  it('records an account created, by whom and through which channel, without its password', async () => {
    const created = await accounts.createAccount(via(root, 'rest-api'), {
      username: 'erin',
      password: 'erin-secret-password',
    })
    const entries = await entriesAbout(created.id)
    expect(entries).toEqual([
      expect.objectContaining({
        by: { accountId: root.id, username: 'root' },
        channels: ['rest-api'],
        projectId: null,
        action: 'account.created',
        subject: { type: 'account', id: created.id },
        details: { username: 'erin' },
      }),
    ])
    const stored = await x.db.select().from(auditLog).where(eq(auditLog.subjectId, created.id))
    expect(JSON.stringify(stored)).not.toMatch(/erin-secret-password|argon2/)
  })

  it('records nothing for an account creation that is refused', async () => {
    const before = (await audit.readLog(via(root))).length
    await refused(
      accounts.createAccount(via(alice), { username: 'frank', password: 'pw' }),
      'forbidden',
    )
    await refused(
      accounts.createAccount(via(root), { username: 'erin', password: 'pw' }),
      'conflict',
    )
    await refused(accounts.createAccount(via(root), { username: '', password: 'pw' }), 'invalid')
    expect(await audit.readLog(via(root))).toHaveLength(before)
  })

  it('creates no account when its entry cannot be written', async () => {
    const failing = new AccountService(x.db, new UnavailableAuditLog(x.db))
    await expect(
      failing.createAccount(via(root), { username: 'ghost', password: 'pw' }),
    ).rejects.toThrow('the audit log is not available')
    const all = await accounts.listAccounts(via(root))
    expect(all.map((a) => a.username)).not.toContain('ghost')
  })

  it('records a person made a system admin, by whom and through which channel', async () => {
    const gina = await seedAccount(x.db, { username: 'gina' })
    await accounts.makeSystemAdmin(via(root, 'ui'), gina.id)
    expect(await entriesAbout(gina.id)).toEqual([
      expect.objectContaining({
        by: { accountId: root.id, username: 'root' },
        channels: ['ui'],
        action: 'account.made-system-admin',
        subject: { type: 'account', id: gina.id },
        details: { username: 'gina' },
      }),
    ])
  })

  it('records nothing when the person already is a system admin, or there is no such account', async () => {
    const hugo = await seedAccount(x.db, { username: 'hugo', systemAdmin: true })
    await expect(accounts.makeSystemAdmin(via(root), hugo.id)).resolves.toMatchObject({
      systemAdmin: true,
    })
    expect(await entriesAbout(hugo.id)).toEqual([])
    const missing = randomUUID()
    await refused(accounts.makeSystemAdmin(via(root), missing), 'not-found')
    expect(await entriesAbout(missing)).toEqual([])
  })

  it('records one change when two system admins make the same person one at once', async () => {
    const ivy = await seedAccount(x.db, { username: 'ivy' })
    await Promise.all([
      accounts.makeSystemAdmin(via(root), ivy.id),
      accounts.makeSystemAdmin(via(root), ivy.id),
    ])
    expect(await entriesAbout(ivy.id)).toHaveLength(1)
  })

  it('makes no one a system admin when its entry cannot be written', async () => {
    const jo = await seedAccount(x.db, { username: 'jo' })
    const failing = new AccountService(x.db, new UnavailableAuditLog(x.db))
    await expect(failing.makeSystemAdmin(via(root), jo.id)).rejects.toThrow(
      'the audit log is not available',
    )
    const all = await accounts.listAccounts(via(root))
    expect(all.find((a) => a.id === jo.id)?.systemAdmin).toBe(false)
  })
})

describe('test cases through the REST API', () => {
  // Each test case below needs parts that later solution components bring: sign-in (SC-052) and
  // the API tokens (SC-055) for the UI and REST API channels, projects (SC-017) and the project
  // role store (SC-014), tasks (SC-001), proposals (SC-010, SC-048), the MCP server (SC-027) and
  // the GitHub change handler (SC-023). Until they land, each test checks the audit log's part of
  // its test case: the change is recorded through the service layer, or made through the REST API
  // where a change of that kind exists, and the log is read through the REST API as the test case
  // reads it. The "Pending" note in each names what the full test case still waits for.
  let x: TestDatabase
  let app: ReturnType<typeof buildApp>
  let roles: ReturnType<typeof roleTable>
  let audit: AuditLogService
  let root: Seeded
  let alice: Seeded
  let bob: Seeded
  let carol: Seeded

  beforeAll(async () => {
    x = await createTestDatabase()
    roles = roleTable()
    audit = new AuditLogService(x.db, roles)
    const services: Services = { accounts: new AccountService(x.db, audit), audit }
    app = buildApp({}, { authenticators: [testAuthenticator], services })
    root = await seedAccount(x.db, { username: 'root', systemAdmin: true })
    alice = await seedAccount(x.db, { username: 'alice' })
    bob = await seedAccount(x.db, { username: 'bob' })
    carol = await seedAccount(x.db, { username: 'carol' })
  })

  afterAll(async () => {
    await app?.close()
    await x?.drop()
  })

  /** A project created by `creator`, who is its admin, as SC-017 will make it. */
  const project = (creator: Seeded) => {
    const id = randomUUID()
    roles.grant(creator, id, 'admin')
    return id
  }

  const readLog = (reader: Seeded, projectId?: string) =>
    app.inject({
      method: 'GET',
      url: '/api/audit-log',
      query: projectId === undefined ? {} : { projectId },
      headers: as(reader),
    })

  /** The entries of a log as the REST API sends them. */
  type Sent = Omit<AuditEntry, 'at'> & { at: string }

  /**
   * Expects `at`, as sent, to be the time of a change made after `t`: no earlier than `t`, no
   * later than the database's clock now, and within the minute after `t`, as "at `t` (to the
   * minute)" asks.
   */
  const expectAtTime = async (at: string, t: Date) => {
    const sent = new Date(at).getTime()
    expect(sent).toBeGreaterThanOrEqual(t.getTime())
    expect(sent).toBeLessThanOrEqual((await now(x.db)).getTime())
    expect(sent - t.getTime()).toBeLessThan(60_000)
  }

  describe('TC-170: a change in the UI is logged with who, when and the UI channel', () => {
    it('logs a change made through the UI with who made it, when and the UI channel alone', async () => {
      const t = await now(x.db)
      const response = await app.inject({
        method: 'POST',
        url: '/api/accounts',
        headers: as(root, 'ui'),
        payload: { username: 'tc170', password: 'pw' },
      })
      expect(response.statusCode).toBe(201)
      const created = response.json<{ id: string }>()

      const log = await readLog(root)
      expect(log.statusCode).toBe(200)
      const entry = log.json<Sent[]>().find((e) => e.subject.id === created.id)
      expect(entry).toMatchObject({ by: { username: 'root' }, channels: ['ui'] })
      await expectAtTime(entry!.at, t)
    })

    // Pending: TC-170 in full: alice, signed in, renames task T in Apollo in the browser and reads Apollo's log (SC-052, SC-017, SC-014, SC-001).
  })

  describe('TC-171: a change through the REST API is logged with the REST API channel', () => {
    it('logs a change made through the REST API with who made it, when and the REST API channel', async () => {
      const t = await now(x.db)
      const response = await app.inject({
        method: 'POST',
        url: '/api/accounts',
        headers: as(root, 'rest-api'),
        payload: { username: 'tc171', password: 'pw' },
      })
      const created = response.json<{ id: string }>()
      const entry = (await readLog(root)).json<Sent[]>().find((e) => e.subject.id === created.id)
      expect(entry).toMatchObject({ by: { username: 'root' }, channels: ['rest-api'] })
      expect(entry!.channels).not.toContain('ui')
      await expectAtTime(entry!.at, t)
    })

    // Pending: TC-171 in full: with alice's API token, rename task T in Apollo and read Apollo's log (SC-016, SC-055, SC-017, SC-014, SC-001).
  })

  describe('TC-172: creating a proposal through the MCP server is logged with the MCP channel', () => {
    it("logs a change made through the MCP server with the MCP channel, in the project's log", async () => {
      const apollo = project(alice)
      const t = await now(x.db)
      await audit.record(x.db, via(alice, 'mcp'), {
        action: 'proposal.created',
        subject: { type: 'proposal', id: 'P' },
        projectId: apollo,
      })
      const entries = (await readLog(alice, apollo)).json<Sent[]>()
      expect(entries).toHaveLength(1)
      expect(entries[0]).toMatchObject({
        by: { username: 'alice' },
        channels: ['mcp'],
        action: 'proposal.created',
      })
      await expectAtTime(entries[0]!.at, t)
      expect(entries.some((e) => e.subject.type === 'task')).toBe(false)
    })

    // Pending: TC-172 in full: through the MCP server with alice's token, create a proposal moving T in Apollo, and check that no entry records a change to T (SC-016, SC-055, SC-017, SC-014, SC-001, SC-010, SC-027).
  })

  describe('TC-173: a change arriving from GitHub is logged with the GitHub channel', () => {
    it('logs a change arriving from GitHub with the GitHub channel and who made it', async () => {
      const apollo = project(alice)
      const t = await now(x.db)
      await audit.record(x.db, via(alice, 'github'), {
        action: 'task.finished',
        subject: { type: 'task', id: 'T' },
        projectId: apollo,
      })
      const [entry] = (await readLog(alice, apollo)).json<Sent[]>()
      expect(entry).toMatchObject({ by: { username: 'alice' }, channels: ['github'] })
      expect(new Date(entry!.at).getTime()).toBeGreaterThanOrEqual(t.getTime())
      expect(new Date(entry!.at).getTime()).toBeLessThanOrEqual((await now(x.db)).getTime())
    })

    // Pending: TC-173 in full: tc-writer closes issue #1 and T is finished through GitHub (SC-017, SC-014, SC-001, SC-019, SC-110, SC-022, SC-054, SC-023). Open question for the owner: the TC says it is not stated how a GitHub user with no account in the tool is named, and the log now records only accounts as the ones who made a change.
  })

  describe('TC-203: a system admin reads the whole audit log', () => {
    it('shows a system admin with no project role the changes in every project', async () => {
      const apollo = project(alice)
      const borealis = project(bob)
      await audit.record(x.db, via(alice), renamed(apollo, 'A', 'A', 'A2'))
      await audit.record(x.db, via(bob), renamed(borealis, 'B', 'B', 'B2'))
      const response = await readLog(root)
      expect(response.statusCode).toBe(200)
      const renames = response
        .json<Sent[]>()
        .filter((e) => e.projectId === apollo || e.projectId === borealis)
      expect(renames.map((e) => e.subject.id).sort()).toEqual(['A', 'B'])
    })

    // Pending: TC-203 in full: alice and bob rename tasks A and B in projects they created (SC-017, SC-001).
  })

  describe("TC-204: project admins and read-write members read only their projects' audit log", () => {
    it('lets alice and carol read Apollo, refuses them Borealis, and never shows the renaming of B', async () => {
      const apollo = project(alice)
      roles.grant(carol, apollo, 'read-write')
      const borealis = project(bob)
      roles.grant(alice, borealis, 'read-only')
      roles.grant(carol, borealis, 'read-only')
      await audit.record(x.db, via(alice), renamed(apollo, 'A', 'A', 'A2'))
      await audit.record(x.db, via(bob), renamed(borealis, 'B', 'B', 'B2'))

      for (const reader of [alice, carol]) {
        const own = await readLog(reader, apollo)
        expect(own.statusCode).toBe(200)
        expect(own.json<Sent[]>().map((e) => e.subject.id)).toEqual(['A'])
        const other = await readLog(reader, borealis)
        expect(other.statusCode).toBe(403)
        expect(other.body).not.toContain('"B"')
        expect((await readLog(reader)).statusCode).toBe(403)
      }
    })

    // Pending: TC-204 in full: with Apollo and Borealis created and their members' roles set (SC-017, SC-014, SC-001).
  })

  describe('TC-205: read-only members and contributors are refused the audit log', () => {
    it("refuses Apollo's read-only member and contributor, and shows neither the renaming of A", async () => {
      const apollo = project(alice)
      roles.grant(bob, apollo, 'read-only')
      roles.grant(carol, apollo, 'contributor')
      await audit.record(x.db, via(alice), renamed(apollo, 'A', 'A', 'A2'))
      for (const reader of [bob, carol]) {
        const response = await readLog(reader, apollo)
        expect(response.statusCode).toBe(403)
        expect(response.body).not.toContain('"A"')
      }
    })

    // Pending: TC-205 in full: with Apollo created and bob and carol given their roles (SC-017, SC-014, SC-001).
  })

  describe("TC-206: an approved proposal's changes are logged as the approver's", () => {
    it('names bob, who approved, as the one who made each move, and never alice', async () => {
      const apollo = project(alice)
      roles.grant(bob, apollo, 'read-write')
      for (const task of ['A', 'B']) {
        await audit.recordApprovedProposalChange(x.db, via(bob, 'ui'), 'mcp', {
          action: 'task.moved',
          subject: { type: 'task', id: task },
          projectId: apollo,
          details: { start: { from: '2027-03-01', to: '2027-03-08' } },
        })
      }
      const moves = (await readLog(alice, apollo))
        .json<Sent[]>()
        .filter((e) => e.action === 'task.moved')
      expect(moves.map((e) => e.subject.id).sort()).toEqual(['A', 'B'])
      for (const move of moves) {
        expect(move.by).toEqual({ accountId: bob.id, username: 'bob' })
        expect(move.by.accountId).not.toBe(alice.id)
      }
    })

    // Pending: TC-206 in full: bob approves a proposal alice's AI made through the MCP server (SC-016, SC-055, SC-017, SC-014, SC-001, SC-010, SC-048, SC-027).
  })

  describe("TC-239: an approved proposal's change is logged with both the MCP and the UI channel", () => {
    it('records the MCP server and the UI as the channels of the move, and neither of the others', async () => {
      const apollo = project(alice)
      roles.grant(bob, apollo, 'read-write')
      await audit.recordApprovedProposalChange(x.db, via(bob, 'ui'), 'mcp', {
        action: 'task.moved',
        subject: { type: 'task', id: 'A' },
        projectId: apollo,
      })
      const [move] = (await readLog(alice, apollo)).json<Sent[]>()
      expect(move?.channels).toEqual(['mcp', 'ui'])
      expect(move?.channels).not.toContain('rest-api')
      expect(move?.channels).not.toContain('github')
    })

    // Pending: TC-239 in full: bob approves the proposal in the browser (SC-016, SC-055, SC-017, SC-014, SC-001, SC-010, SC-048, SC-027, SC-052). SC-010 must keep the channel each proposal was made through, for SC-048 to hand to the audit log.
  })
})

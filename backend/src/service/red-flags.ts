import { and, asc, eq, inArray, isNotNull, isNull, ne, sql } from 'drizzle-orm'
import type { Database, Executor, Transaction } from '../db/client.ts'
import { absences, accounts, RED_FLAG_KINDS, redFlags, tasks } from '../db/schema.ts'
import { assigneesColumn, loadOverridesColumn } from './assignment.ts'
import {
  type AvailabilityTask,
  type PersonDay,
  type Unavailability,
  unavailableTasks,
} from './assignee-availability.ts'
import type { Caller } from './caller.ts'
import { type AssignedTask, dailyLoads } from './daily-person-load.ts'
import { readCalendars } from './plan-scheduling.ts'
import { taskPersonLoad } from './person-load.ts'
import type { ProjectRoleService } from './project-roles.ts'
import type { Calendars } from './scheduler.ts'
import { everyViolation, type Violation, type ViolationKind } from './violations.ts'

/** What a red flag is about (DD-029). */
export type RedFlagKind = (typeof RED_FLAG_KINDS)[number]

/** A task, as a red flag names it. */
export interface FlaggedTask {
  id: string
  projectId: string
}

/** A person overloaded on a day (FR-042), red to every project involved (FR-043). */
export interface OverloadDetail {
  accountId: string
  date: string
}

/** A task its assigned people cannot do in its time (FR-020), and why (SC-042). */
export interface AssigneeUnavailableDetail {
  task: FlaggedTask
  /** The days within the task on which one of its assigned people is overloaded. */
  overloads: PersonDay[]
  /** Whether holidays leave it fewer working days in its time than its duration. */
  holiday: boolean
}

/** A milestone or dependency violation (SC-007): `task` is blocked by `blocker`. */
export interface ViolationDetail {
  task: FlaggedTask
  blocker: FlaggedTask
  crossProject: boolean
  start: string
  blockerFinish: string
}

/** A red flag as the register finds it, before it is stored: one flag as one project sees it. */
export type FoundFlag =
  | { projectId: string; kind: 'overload'; key: string; detail: OverloadDetail }
  | {
      projectId: string
      kind: 'assignee-unavailable'
      key: string
      detail: AssigneeUnavailableDetail
    }
  | { projectId: string; kind: ViolationKind; key: string; detail: ViolationDetail }

/** A red flag currently raised in a project, with when it appeared there. */
export type RedFlag = FoundFlag & { id: string; raisedAt: Date }

/** A person's overloaded day, with the projects whose tasks load them that day. */
export interface Overload {
  accountId: string
  date: string
  /** The projects involved (FR-043): each one with a task that puts load on the person that day. */
  projects: readonly string[]
}

/**
 * The red flags of what the detectors found, each once for every project it concerns:
 *
 * - a person's overload on a day, in every project involved (FR-042, FR-043);
 * - a task its assigned people cannot do in its time, in the task's project (FR-020);
 * - a violation, in the dependent task's project and, across a project boundary, in the
 *   blocker's too (FR-147).
 */
export function flagsOf(found: {
  overloads: readonly Overload[]
  unavailable: readonly Unavailability[]
  violations: readonly Violation[]
}): FoundFlag[] {
  const flags: FoundFlag[] = []
  for (const { accountId, date, projects } of found.overloads) {
    for (const projectId of projects) {
      flags.push({
        projectId,
        kind: 'overload',
        key: `overload:${accountId}:${date}`,
        detail: { accountId, date },
      })
    }
  }
  for (const { taskId, projectId, overloads, holiday } of found.unavailable) {
    flags.push({
      projectId,
      kind: 'assignee-unavailable',
      key: `assignee-unavailable:${taskId}`,
      detail: { task: { id: taskId, projectId }, overloads, holiday },
    })
  }
  for (const violation of found.violations) {
    const detail: ViolationDetail = {
      task: { id: violation.task.id, projectId: violation.task.projectId },
      blocker: { id: violation.blocker.id, projectId: violation.blocker.projectId },
      crossProject: violation.crossProject,
      start: violation.start,
      blockerFinish: violation.blockerFinish,
    }
    const key = `${violation.kind}:${violation.task.id}:${violation.blocker.id}`
    const projects = violation.crossProject
      ? [violation.task.projectId, violation.blocker.projectId]
      : [violation.task.projectId]
    for (const projectId of projects) {
      flags.push({ projectId, kind: violation.kind, key, detail })
    }
  }
  return flags
}

/** A flag stored in the register, as the reconciliation compares it. */
export interface StoredFlag {
  id: string
  projectId: string
  key: string
  detail: unknown
}

/** What a refresh of the register must do to match what the detectors found. */
export interface FlagChanges {
  /** The flags found that are not raised yet: new red flags. */
  raise: FoundFlag[]
  /** The flags raised whose conflict is gone (FR-021). */
  clear: StoredFlag[]
  /** The flags still raised whose detail changed, with the stored flag's id. */
  update: { id: string; detail: FoundFlag['detail'] }[]
}

/** Compares the register with what the detectors found. */
export function changesFor(
  stored: readonly StoredFlag[],
  found: readonly FoundFlag[],
): FlagChanges {
  const identity = (flag: { projectId: string; key: string }) => `${flag.projectId} ${flag.key}`
  const wanted = new Map(found.map((flag) => [identity(flag), flag]))
  const have = new Map(stored.map((flag) => [identity(flag), flag]))
  const changes: FlagChanges = { raise: [], clear: [], update: [] }
  for (const [id, flag] of wanted) {
    const current = have.get(id)
    if (!current) changes.raise.push(flag)
    else if (canonical(current.detail) !== canonical(flag.detail)) {
      changes.update.push({ id: current.id, detail: flag.detail })
    }
  }
  for (const [id, flag] of have) {
    if (!wanted.has(id)) changes.clear.push(flag)
  }
  return changes
}

/** JSON with every object's keys sorted, so that two equal values compare equal. */
function canonical(value: unknown): string {
  return JSON.stringify(value, (_key, inner: unknown) =>
    inner !== null && typeof inner === 'object' && !Array.isArray(inner)
      ? Object.fromEntries(Object.entries(inner).sort(([a], [b]) => a.localeCompare(b)))
      : inner,
  )
}

/**
 * The lock that makes refreshes of the register take turns, so that each one compares against
 * what the one before it stored. A two-key lock, so that it never meets the relations lock, which
 * has one; it is taken last in a transaction, after the plan and relations locks.
 */
const RED_FLAGS_LOCK_CLASS = 0x5c_00_43

/** The most rows one statement writes, well below PostgreSQL's limit on parameters. */
const CHUNK = 1000

/** What a refresh changed in the register, for whoever is told of new red flags (FR-083). */
export interface RedFlagRefresh {
  raised: FoundFlag[]
  cleared: StoredFlag[]
}

/**
 * Brings the red flag register (SC-043) up to date with the plan as the transaction sees it: each
 * red flag the detectors now find and the register lacks is raised, recording when it appeared;
 * each one the register holds whose conflict is gone is cleared (FR-021). Every change that can
 * raise or clear a red flag calls it in its own transaction, after its last write: to tasks, their
 * dates, assignments, loads and relations, and to calendars, capacities and absences.
 */
export async function refreshRedFlags(tx: Transaction): Promise<RedFlagRefresh> {
  await tx.execute(sql`select pg_advisory_xact_lock(${RED_FLAGS_LOCK_CLASS}::integer, 0)`)
  const found = await detectRedFlags(tx)
  const stored = await tx
    .select({
      id: redFlags.id,
      projectId: redFlags.projectId,
      key: redFlags.key,
      detail: redFlags.detail,
    })
    .from(redFlags)
  const changes = changesFor(stored, found)
  for (let i = 0; i < changes.clear.length; i += CHUNK) {
    const ids = changes.clear.slice(i, i + CHUNK).map((flag) => flag.id)
    await tx.delete(redFlags).where(inArray(redFlags.id, ids))
  }
  for (let i = 0; i < changes.raise.length; i += CHUNK) {
    await tx.insert(redFlags).values(
      changes.raise.slice(i, i + CHUNK).map(({ projectId, kind, key, detail }) => ({
        projectId,
        kind,
        key,
        detail: { ...detail },
      })),
    )
  }
  for (const { id, detail } of changes.update) {
    await tx
      .update(redFlags)
      .set({ detail: { ...detail } })
      .where(eq(redFlags.id, id))
  }
  return { raised: changes.raise, cleared: changes.clear }
}

/**
 * Every red flag the plan raises now, in every project: the overload detector's (SC-040), the
 * assignee availability flag detector's (SC-042) and the milestone and dependency violation
 * detector's (SC-007).
 */
export async function detectRedFlags(executor: Executor): Promise<FoundFlag[]> {
  // Only a task with both its dates is read, which the comparisons require, so they are typed as
  // present; a milestone takes no time and loads no one (FR-191), and a cancelled task is out of
  // the plan (FR-127).
  const rows = await executor
    .select({
      id: tasks.id,
      projectId: tasks.projectId,
      title: tasks.title,
      plannedStart: sql<string>`${tasks.plannedStart}`,
      plannedFinish: sql<string>`${tasks.plannedFinish}`,
      durationWorkingDays: tasks.durationWorkingDays,
      aiShare: tasks.aiShare,
      aiOnlyLoad: tasks.aiOnlyLoad,
      // Qualified by hand: Drizzle writes a column of the selected table without its table.
      parent: sql<boolean>`exists (select 1 from "tasks" as "subtask" where "subtask"."parent_id" = "tasks"."id")`,
      assignees: assigneesColumn,
      loadOverrides: loadOverridesColumn,
    })
    .from(tasks)
    .where(
      and(
        ne(tasks.status, 'cancelled'),
        isNull(tasks.milestoneVariant),
        isNotNull(tasks.plannedStart),
        isNotNull(tasks.plannedFinish),
      ),
    )
    .orderBy(asc(tasks.createdAt), asc(tasks.id))

  const byPerson = new Map<string, AssignedTask[]>()
  for (const row of rows) {
    const own = taskPersonLoad({
      aiShare: row.aiShare,
      aiOnlyLoad: row.aiOnlyLoad,
      milestone: false,
    })
    if (own === null) continue
    for (const accountId of row.assignees) {
      const assigned: AssignedTask = {
        id: row.id,
        projectId: row.projectId,
        title: row.title,
        plannedStart: row.plannedStart,
        plannedFinish: row.plannedFinish,
        load: row.loadOverrides[accountId] ?? own,
        assignees: row.assignees,
      }
      const list = byPerson.get(accountId)
      if (list) list.push(assigned)
      else byPerson.set(accountId, [assigned])
    }
  }

  const people = [...byPerson.keys()]
  const calendars = await readCalendars(executor, people)
  const overloads = await overloadsOf(executor, byPerson, calendars)
  const overloaded = new Map<string, string[]>()
  for (const { accountId, date } of overloads) {
    const dates = overloaded.get(accountId)
    if (dates) dates.push(date)
    else overloaded.set(accountId, [date])
  }
  const availability: AvailabilityTask[] = rows.map((row) => ({
    id: row.id,
    projectId: row.projectId,
    plannedStart: row.plannedStart,
    plannedFinish: row.plannedFinish,
    durationWorkingDays: row.durationWorkingDays,
    parent: row.parent,
    assignees: row.assignees,
  }))
  return flagsOf({
    overloads,
    unavailable: unavailableTasks(availability, overloaded, calendars),
    violations: await everyViolation(executor),
  })
}

/**
 * Each day on which one of the people is overloaded (FR-042), with the projects involved: their
 * load that day, from the daily person load aggregator (SC-006), is above their capacity, 0 on
 * the days of their absences (FR-151). Only the days of their tasks are looked at, since no
 * other day has a load.
 */
async function overloadsOf(
  executor: Executor,
  byPerson: ReadonlyMap<string, readonly AssignedTask[]>,
  calendars: Calendars,
): Promise<Overload[]> {
  const people = [...byPerson.keys()]
  if (people.length === 0) return []
  const capacities = new Map(
    (
      await executor
        .select({ id: accounts.id, capacity: accounts.capacity })
        .from(accounts)
        .where(inArray(accounts.id, people))
    ).map((row) => [row.id, row.capacity]),
  )
  const absent = await executor
    .select({ accountId: absences.accountId, from: absences.startsOn, to: absences.endsOn })
    .from(absences)
    .where(inArray(absences.accountId, people))

  const overloads: Overload[] = []
  for (const [accountId, assigned] of byPerson) {
    const capacity = capacities.get(accountId)
    if (capacity === undefined) continue
    const from = assigned.map((task) => task.plannedStart).sort()[0]
    const to = assigned
      .map((task) => task.plannedFinish)
      .sort()
      .at(-1)
    if (from === undefined || to === undefined) continue
    const days = dailyLoads(from, to, {
      tasks: assigned,
      calendars,
      absences: absent.filter((absence) => absence.accountId === accountId),
      capacity,
      readable: new Set(assigned.map((task) => task.projectId)),
    })
    for (const day of days) {
      if (!day.overloaded) continue
      const projects = [
        ...new Set(day.tasks.filter((task) => task.load > 0).map((task) => task.projectId)),
      ]
      overloads.push({ accountId, date: day.date, projects })
    }
  }
  return overloads
}

/** A row of the register as the flag it holds; the detail is the one its kind gives. */
function toRedFlag(row: typeof redFlags.$inferSelect): RedFlag {
  const { id, projectId, kind, key, raisedAt } = row
  const detail: unknown = row.detail
  const base = { id, projectId, key, raisedAt }
  if (kind === 'overload' && isOverloadDetail(detail)) {
    return { ...base, kind, detail }
  }
  if (kind === 'assignee-unavailable' && isUnavailableDetail(detail)) {
    return { ...base, kind, detail }
  }
  if (kind !== 'overload' && kind !== 'assignee-unavailable' && isViolationDetail(detail)) {
    return { ...base, kind, detail }
  }
  throw new Error(`The red flag ${id} holds a detail its kind ${kind} does not have`)
}

// The register writes each detail with the shape its kind gives, so the field that only that shape
// has tells it apart.
function isOverloadDetail(detail: unknown): detail is OverloadDetail {
  return typeof detail === 'object' && detail !== null && 'accountId' in detail
}

function isUnavailableDetail(detail: unknown): detail is AssigneeUnavailableDetail {
  return typeof detail === 'object' && detail !== null && 'overloads' in detail
}

function isViolationDetail(detail: unknown): detail is ViolationDetail {
  return typeof detail === 'object' && detail !== null && 'blocker' in detail
}

/** Whether the flag is a violation across a project boundary (FR-147). */
function isCrossProject(flag: RedFlag): flag is RedFlag & { detail: ViolationDetail } {
  return 'blocker' in flag.detail && flag.detail.crossProject
}

/**
 * The red flag register of the service layer (SC-043, DD-039): the red flags currently raised,
 * each with when it appeared, kept up to date by `refreshRedFlags` in every change that can raise
 * or clear one. A flag is cleared once the conflict behind it is gone, with no other change
 * needed (FR-021).
 */
export class RedFlagService {
  readonly #db: Database
  readonly #roles: ProjectRoleService

  constructor(db: Database, roles: ProjectRoleService) {
    this.#db = db
    this.#roles = roles
  }

  /**
   * The red flags currently raised in the project, in the order they appeared, for anyone with a
   * role in it (FR-106). Refused as not visible to someone with no role in it (FR-017). A
   * violation across a project boundary is given only to a caller who can read both projects, as
   * the violation detector gives it (FR-059).
   */
  async redFlagsOf(caller: Caller, projectId: string): Promise<RedFlag[]> {
    await this.#roles.permissions.require(caller, projectId, 'read')
    const rows = await this.#db
      .select()
      .from(redFlags)
      .where(eq(redFlags.projectId, projectId))
      .orderBy(asc(redFlags.raisedAt), asc(redFlags.key))
    const flags = rows.map(toRedFlag)
    if (!flags.some(isCrossProject)) return flags
    const readable = await this.#roles.readableProjects(caller.accountId)
    return flags.filter(
      (flag) =>
        !isCrossProject(flag) ||
        (readable.has(flag.detail.task.projectId) && readable.has(flag.detail.blocker.projectId)),
    )
  }
}

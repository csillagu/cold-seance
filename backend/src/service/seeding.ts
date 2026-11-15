import { inArray, sql } from 'drizzle-orm'
import type { Database, Transaction } from '../db/client.ts'
import {
  accounts,
  repositories,
  taskAssignees,
  taskBlockedBy,
  taskIssues,
  tasks,
} from '../db/schema.ts'
import type { ISSUE_SEEN_STATES } from '../db/schema.ts'
import type { AuditLogService } from './audit.ts'
import type { Caller } from './caller.ts'
import { ServiceError } from './errors.ts'
import { lockIssueLinks, UNTITLED_ISSUE_TITLE } from './github-issue-tasks.ts'
import { lockPlan, PlanScheduling } from './plan-scheduling.ts'
import type { TaskStatus } from './permissions.ts'
import { NOT_PULLED_MESSAGE, type ProjectRepositoryService } from './project-repositories.ts'
import type { ProjectRoleService } from './project-roles.ts'
import { refreshRedFlags } from './red-flags.ts'
import { isUuid } from './system-admins.ts'
import { localToday, type Today } from './task-status.ts'
import { lockRelations } from './task-relations.ts'

/** An issue of a repository as the seeding source reads it from GitHub. */
export interface SeedIssue {
  /** GitHub's own id for the issue, which its relations name it by. */
  githubId: number
  number: number
  title: string
  /** Open, closed (as completed, or for any reason but not planned), or closed as not planned. */
  state: Exclude<(typeof ISSUE_SEEN_STATES)[number], 'deleted'>
  /** When it was closed, as GitHub records it; null for an open issue. */
  closedAt: Date | null
  /** The GitHub logins of its assignees. */
  assignees: string[]
  /** GitHub's ids of its sub-issues, in any repository. */
  subIssueIds: number[]
  /** GitHub's ids of the issues it is blocked by, in any repository. */
  blockedByIds: number[]
  /**
   * What its items in GitHub Projects say of it in the configured status field (SRC-252):
   * started, on hold, or neither, which an issue in Projects that disagree also is.
   */
  projectStatus: 'started' | 'on-hold' | null
  /** The status option its Project items agree on, null for none or for no agreement. */
  statusOption: string | null
}

/** A repository the tool cannot reach on GitHub: no App installed on it, no token given it. */
export class SeedingUnreachableError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'SeedingUnreachableError'
  }
}

/**
 * Where the seeding importer reads a repository's issues from: GitHub, through the GitHub client
 * (SC-106, `gitHubSeedingSource`).
 */
export interface SeedingSource {
  /**
   * Every issue of the repository, open and closed, but none of its pull requests. Rejects with
   * a `SeedingUnreachableError` if the tool cannot reach the repository, and with any other error
   * if GitHub fails to answer.
   */
  issuesOf(repository: { owner: string; name: string }): Promise<SeedIssue[]>
}

/** Why the import left an issue out (FR-163). */
export type SkipReason =
  /** The issue is a task of this project already, from an earlier import or otherwise. */
  | 'already-in-project'
  /** The issue is a task of another project. */
  | 'in-another-project'
  /** The issue is blocked by one this import does not bring in. */
  | 'blocked-from-outside'

/** What a seeding import brought in and what it left out. */
export interface SeedingResult {
  projectId: string
  /** The tasks it created, one for each issue, in the order of the repositories and issues. */
  imported: { taskId: string; repositoryId: string; issueNumber: number }[]
  /** The issues it left out, with why. */
  skipped: { repositoryId: string; issueNumber: number; reason: SkipReason }[]
}

export const NO_SEEDING_SOURCE_MESSAGE = 'Seeding from GitHub is not available'
export const SEEDING_FAILED_MESSAGE =
  'The seeding failed: GitHub could not be read. Nothing was imported.'
export const SEEDING_CYCLE_MESSAGE =
  "The seeding failed: the issues' blocked-by relations form a cycle. Nothing was imported."

/** One issue as the import holds it: what GitHub says, and the repository it came from. */
interface Found extends SeedIssue {
  repositoryId: string
}

/**
 * The GitHub seeding importer (SC-025): it seeds a project from one or more GitHub repositories
 * the project pulls issues from (FR-102), in one import that is all or nothing (FR-137):
 *
 * - Every issue of the chosen repositories is read from GitHub first, pull requests left out; if
 *   any read fails, the import fails and nothing is brought in. Only then is everything written,
 *   in one transaction.
 * - An open issue becomes an unscheduled task (FR-103): no planned dates, no duration. It is in
 *   progress if its Projects status field is in the started option, on hold if in the on-hold
 *   option, not started otherwise. A task brought in in progress is recorded as started on the day
 *   of the import.
 * - A closed issue becomes a done task (FR-104), whatever the reason it was closed, with its actual
 *   finish the day GitHub records it was closed, in the backend's time zone.
 * - Each task has the issue's title, is assigned to the issue's repository and linked to the issue,
 *   so that it is synced with it from then on. Its assignees are the accounts linked to the
 *   issue's assignees on GitHub (FR-135) who can read the project (FR-031); the others are left off.
 * - A sub-issue is made a subtask of its parent issue's task, if that task is in the project; a
 *   blocked-by relation becomes one between the two tasks.
 * - Issues are skipped (FR-163), which is not a failure: one that is a task already, in this
 *   project (as after an earlier import) or another; and one blocked by an issue the import does
 *   not bring in: outside the chosen repositories, a task of another project, or skipped itself.
 *
 * Only the project's admins may seed it (UC-010, FR-109). Nothing is written to GitHub: the
 * planning mirror (SC-022) is not told of the new tasks, as their planning is GitHub's. Each task
 * is recorded in the audit log, by the caller, as created by the seeding.
 */
export class SeedingService {
  readonly #db: Database
  readonly #audit: AuditLogService
  readonly #roles: ProjectRoleService
  readonly #repositories: ProjectRepositoryService
  readonly #source: SeedingSource | undefined
  readonly #today: Today
  readonly #scheduling: PlanScheduling

  constructor(
    db: Database,
    audit: AuditLogService,
    roles: ProjectRoleService,
    projectRepositories: ProjectRepositoryService,
    source: SeedingSource | undefined,
    today: Today = localToday,
  ) {
    this.#db = db
    this.#audit = audit
    this.#roles = roles
    this.#repositories = projectRepositories
    this.#source = source
    this.#today = today
    this.#scheduling = new PlanScheduling(audit)
  }

  /**
   * Seeds the project from the registered repositories `repositoryIds`. Refused as not visible to
   * someone with no role in the project, as forbidden to anyone but its admins, as invalid for no
   * repository or one named twice, and as a conflict for a repository the project does not pull
   * issues from, or one the tool cannot reach on GitHub. Refused as unavailable, with nothing
   * imported, if GitHub cannot be read.
   */
  async seed(caller: Caller, projectId: string, repositoryIds: unknown): Promise<SeedingResult> {
    await this.#roles.permissions.require(caller, projectId, 'manage-project')
    const ids = repositoryIdsOf(repositoryIds)
    for (const id of ids) {
      if (!(await this.#repositories.pulls(projectId, id))) {
        throw new ServiceError('conflict', NOT_PULLED_MESSAGE)
      }
    }
    const source = this.#source
    if (source === undefined) throw new ServiceError('unavailable', NO_SEEDING_SOURCE_MESSAGE)

    const rows = await this.#db
      .select({ id: repositories.id, owner: repositories.owner, name: repositories.name })
      .from(repositories)
      .where(inArray(repositories.id, ids))
    const found: Found[] = []
    for (const id of ids) {
      const repository = rows.find((row) => row.id === id)
      if (repository === undefined) throw new ServiceError('conflict', NOT_PULLED_MESSAGE)
      let issues: SeedIssue[]
      try {
        issues = await source.issuesOf(repository)
      } catch (error) {
        if (error instanceof SeedingUnreachableError) {
          throw new ServiceError(
            'conflict',
            `The tool cannot reach ${repository.owner}/${repository.name} on GitHub`,
          )
        }
        throw new ServiceError('unavailable', SEEDING_FAILED_MESSAGE)
      }
      const sorted = [...issues].sort((a, b) => a.number - b.number)
      found.push(...sorted.map((issue) => ({ ...issue, repositoryId: id })))
    }

    return this.#db.transaction(async (tx) => {
      // In the order the other modules take them: relations, issue links, then the plan.
      await lockRelations(tx)
      for (const id of [...ids].sort()) await lockIssueLinks(tx, id)
      await lockPlan(tx, projectId)
      await this.#roles.permissions.require(caller, projectId, 'manage-project', tx)
      for (const id of ids) {
        if (!(await this.#repositories.pulls(projectId, id, { executor: tx, lock: true }))) {
          throw new ServiceError('conflict', NOT_PULLED_MESSAGE)
        }
      }
      return this.#write(tx, caller, projectId, found)
    })
  }

  async #write(
    tx: Transaction,
    caller: Caller,
    projectId: string,
    found: readonly Found[],
  ): Promise<SeedingResult> {
    const byId = new Map(found.map((issue) => [issue.githubId, issue]))
    // The tasks the issues, and the issues they are related to, are linked to already.
    const related = [
      ...new Set(found.flatMap((i) => [i.githubId, ...i.blockedByIds, ...i.subIssueIds])),
    ]
    const links = new Map<number, { taskId: string; projectId: string }>()
    if (related.length > 0) {
      const rows = await tx
        .select({ githubId: taskIssues.githubId, taskId: tasks.id, projectId: tasks.projectId })
        .from(taskIssues)
        .innerJoin(tasks, sql`${tasks.id} = ${taskIssues.taskId}`)
        .where(inArray(taskIssues.githubId, related))
      for (const row of rows) links.set(row.githubId, row)
    }

    const skipped = new Map<number, SkipReason>()
    for (const issue of found) {
      const link = links.get(issue.githubId)
      if (link !== undefined) {
        skipped.set(
          issue.githubId,
          link.projectId === projectId ? 'already-in-project' : 'in-another-project',
        )
      }
    }
    // Whether a blocker is brought in, or is a task of this project already.
    const blockerHere = (id: number) => {
      const link = links.get(id)
      if (link !== undefined) return link.projectId === projectId
      return byId.has(id) && !skipped.has(id)
    }
    // Skipping one issue can leave another blocked by an issue not brought in, so until none is.
    for (let changed = true; changed;) {
      changed = false
      for (const issue of found) {
        if (skipped.has(issue.githubId)) continue
        if (issue.blockedByIds.every(blockerHere)) continue
        skipped.set(issue.githubId, 'blocked-from-outside')
        changed = true
      }
    }
    const imported = found.filter((issue) => !skipped.has(issue.githubId))
    if (hasCycle(imported, skipped)) throw new ServiceError('conflict', SEEDING_CYCLE_MESSAGE)

    const people = await this.#assignable(tx, projectId, imported)
    const today = this.#today()
    const taskOf = new Map<number, string>()
    for (const [githubId, link] of links) {
      if (link.projectId === projectId) taskOf.set(githubId, link.taskId)
    }
    const created: { issue: Found; taskId: string; status: TaskStatus }[] = []
    for (const issue of imported) {
      const status = statusOf(issue)
      const [row] = await tx
        .insert(tasks)
        .values({
          projectId,
          title: issue.title.normalize('NFC').trim() || UNTITLED_ISSUE_TITLE,
          status,
          repositoryId: issue.repositoryId,
          actualStart: status === 'in-progress' ? today : null,
          actualFinish:
            status === 'done' && issue.closedAt !== null ? localToday(issue.closedAt) : null,
        })
        .returning({ id: tasks.id })
      if (!row) throw new Error('The new task was not returned')
      taskOf.set(issue.githubId, row.id)
      created.push({ issue, taskId: row.id, status })
      await tx.insert(taskIssues).values({
        taskId: row.id,
        repositoryId: issue.repositoryId,
        number: issue.number,
        githubId: issue.githubId,
        seenState: issue.state,
        seenStatus: issue.statusOption,
      })
    }

    // The parent of each new task: the issue whose sub-issue it is, if that has a task here.
    const parentOf = new Map<number, string>()
    for (const issue of found) {
      const parentTask = taskOf.get(issue.githubId)
      if (parentTask === undefined) continue
      for (const sub of issue.subIssueIds) parentOf.set(sub, parentTask)
    }
    const details = new Map<string, Record<string, unknown>>()
    for (const { issue, taskId, status } of created) {
      const parentId = parentOf.get(issue.githubId) ?? null
      if (parentId !== null) {
        await tx
          .update(tasks)
          .set({ parentId })
          .where(sql`${tasks.id} = ${taskId}`)
      }
      const blockedBy = issue.blockedByIds.flatMap((id) => {
        const blocker = taskOf.get(id)
        return blocker === undefined ? [] : [blocker]
      })
      for (const blockerId of new Set(blockedBy)) {
        await tx.insert(taskBlockedBy).values({ taskId, blockerId })
      }
      const assignees = [
        ...new Set(issue.assignees.flatMap((login) => people.get(login.toLowerCase()) ?? [])),
      ]
      if (assignees.length > 0) {
        await tx
          .insert(taskAssignees)
          .values(assignees.map((accountId, position) => ({ taskId, accountId, position })))
      }
      details.set(taskId, { parentId, blockedBy: [...new Set(blockedBy)], assignees, status })
    }

    const ids = created.map((c) => c.taskId)
    await this.#scheduling.reschedule(tx, caller, projectId, ids, {
      action: 'project.seeded',
      taskId: ids[0] ?? '',
    })
    await refreshRedFlags(tx)
    for (const { issue, taskId } of created) {
      const [row] = await tx
        .select({
          title: tasks.title,
          actualStart: tasks.actualStart,
          actualFinish: tasks.actualFinish,
        })
        .from(tasks)
        .where(sql`${tasks.id} = ${taskId}`)
      await this.#audit.record(tx, caller, {
        action: 'task.created',
        subject: { type: 'task', id: taskId },
        projectId,
        details: {
          title: row?.title,
          repositoryId: issue.repositoryId,
          issueNumber: issue.number,
          seeded: true,
          ...details.get(taskId),
          actualStart: row?.actualStart ?? null,
          actualFinish: row?.actualFinish ?? null,
        },
      })
    }
    const numberOf = new Map(found.map((issue) => [issue.githubId, issue]))
    const result: SeedingResult = {
      projectId,
      imported: created.map(({ issue, taskId }) => ({
        taskId,
        repositoryId: issue.repositoryId,
        issueNumber: issue.number,
      })),
      skipped: [...skipped].flatMap(([githubId, reason]) => {
        const issue = numberOf.get(githubId)
        return issue === undefined
          ? []
          : [{ repositoryId: issue.repositoryId, issueNumber: issue.number, reason }]
      }),
    }
    await this.#audit.record(tx, caller, {
      action: 'project.seeded',
      subject: { type: 'project', id: projectId },
      projectId,
      details: {
        repositoryIds: [...new Set(found.map((issue) => issue.repositoryId))],
        imported: result.imported.length,
        skipped: result.skipped,
      },
    })
    return result
  }

  /**
   * The accounts the issues' assignees are linked to on GitHub, by lower-case login, of those who
   * can read the project.
   */
  async #assignable(
    tx: Transaction,
    projectId: string,
    issues: readonly Found[],
  ): Promise<Map<string, string>> {
    const logins = [...new Set(issues.flatMap((i) => i.assignees.map((l) => l.toLowerCase())))]
    const people = new Map<string, string>()
    if (logins.length === 0) return people
    const rows = await tx
      .select({ id: accounts.id, login: sql<string>`lower(${accounts.githubLogin})` })
      .from(accounts)
      .where(inArray(sql`lower(${accounts.githubLogin})`, logins))
    for (const row of rows) {
      if ((await this.#roles.roleOf(row.id, projectId, tx)) !== undefined) {
        people.set(row.login, row.id)
      }
    }
    return people
  }
}

/** The repositories to seed from, as the caller names them: at least one, each once. */
function repositoryIdsOf(value: unknown): string[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new ServiceError('invalid', 'Choose at least one repository to seed the project from')
  }
  const ids: string[] = []
  for (const id of value) {
    if (typeof id !== 'string' || !isUuid(id)) {
      throw new ServiceError('invalid', 'A repository is named by its id')
    }
    if (ids.includes(id)) throw new ServiceError('invalid', 'A repository is named twice')
    ids.push(id)
  }
  return ids
}

/** The status an issue is brought in with (FR-103, FR-104, DD-015). */
function statusOf(issue: SeedIssue): TaskStatus {
  if (issue.state !== 'open') return 'done'
  if (issue.projectStatus === 'started') return 'in-progress'
  if (issue.projectStatus === 'on-hold') return 'on-hold'
  return 'not-started'
}

/**
 * Whether the blocked-by relations among the issues brought in form a cycle. Their blockers
 * already in the project block none of them, so a cycle can run through the new ones only.
 */
function hasCycle(imported: readonly Found[], skipped: ReadonlyMap<number, SkipReason>): boolean {
  const blockers = new Map(
    imported.map((issue) => [
      issue.githubId,
      issue.blockedByIds.filter((id) => id !== issue.githubId && !skipped.has(id)),
    ]),
  )
  const state = new Map<number, 'visiting' | 'done'>()
  const visit = (id: number): boolean => {
    const seen = state.get(id)
    if (seen === 'done') return false
    if (seen === 'visiting') return true
    state.set(id, 'visiting')
    for (const next of blockers.get(id) ?? []) {
      if (blockers.has(next) && visit(next)) return true
    }
    state.set(id, 'done')
    return false
  }
  return (
    [...blockers.keys()].some(visit) || imported.some((i) => i.blockedByIds.includes(i.githubId))
  )
}

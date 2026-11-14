import { and, desc, eq, lt, type SQL } from 'drizzle-orm'
import type { Database, Executor } from '../db/client.ts'
import { accounts, auditLog } from '../db/schema.ts'
import { isSystemAdmin, isUuid } from './system-admins.ts'
import type { Caller, Channel } from './caller.ts'
import { notVisible, ServiceError } from './errors.ts'
import { noProjectRoles, type ProjectRole, type ProjectRoles } from './project-roles.ts'

/**
 * A change as a module of the service layer hands it to the audit log: what was done, to what,
 * in which project if any, and the details a reader needs to tell what changed. The details are
 * never secrets, such as a password.
 */
export interface Change {
  /** What was done, as `<subject type>.<verb>`, e.g. `account.created`. */
  action: string
  /** What it was done to. */
  subject: { type: string; id: string }
  /** The project the change belongs to; none for a change outside any project. */
  projectId?: string | null
  details?: Record<string, unknown>
}

/**
 * Someone who made a change on GitHub, as the GitHub change handler (SC-023) passes them in: by
 * their GitHub login, whether or not an account in the tool is linked to it (FR-099, SRC-251).
 */
export interface GitHubUser {
  readonly githubLogin: string
  readonly channel: 'github'
}

/** Whoever a change is recorded as made by: an account, or a GitHub user (SRC-251). */
export type Actor = Caller | GitHubUser

/** Who made a change, as an entry of the log names them. */
export type AuditActor = { accountId: string; username: string } | { githubLogin: string }

/** An entry of the audit log as the service layer hands it out (FR-116). */
export interface AuditEntry {
  id: number
  /** When the change was made. */
  at: Date
  /** Who made it: an account, or for a change made on GitHub, the GitHub login (SRC-251). */
  by: AuditActor
  /**
   * The channels it came through: one, or two for a change from an approved AI proposal, the
   * proposal's channel first and the approval's second.
   */
  channels: Channel[]
  projectId: string | null
  action: string
  subject: { type: string; id: string }
  details: Record<string, unknown>
}

export interface AuditQuery {
  /** Only this project's part of the log; the whole log when not given. */
  projectId?: string
  /** At most this many entries, newest first; `DEFAULT_PAGE_SIZE` when not given. */
  limit?: number
  /** Only entries older than the one with this id, to read the next page. */
  before?: number
}

export const DEFAULT_PAGE_SIZE = 100
export const MAX_PAGE_SIZE = 500

/** The project roles that may read their project's part of the log (FR-138). */
const READER_ROLES: ReadonlySet<ProjectRole> = new Set(['admin', 'read-write'])

/**
 * The audit log, the part of the service layer that records every change with who made it, when
 * and through which channel (FR-116), and serves the log only to those allowed to read it (FR-138)
 * (SC-013). Every channel goes through the one service layer (DD-039), so a module records each
 * change it makes here, in the same transaction as the change: a change is never made without its
 * entry, nor an entry written for a change that did not happen.
 */
export class AuditLogService {
  readonly #db: Database
  readonly #roles: ProjectRoles

  constructor(db: Database, roles: ProjectRoles = noProjectRoles) {
    this.#db = db
    this.#roles = roles
  }

  /**
   * Records a change the caller made, through the caller's channel, at the time of the
   * transaction `executor` runs in. A change made on GitHub is recorded under the GitHub login
   * of whoever made it (SRC-251).
   */
  async record(executor: Executor, caller: Actor, change: Change): Promise<void> {
    await this.#write(executor, actorOf(caller), [caller.channel], change)
  }

  /**
   * Records a change that an approved AI proposal applies. The person who approved it is recorded
   * as the one who made the change (FR-139), and both channels are recorded, in this order: the
   * one the proposal was made through, then the one it was approved through (FR-164).
   */
  async recordApprovedProposalChange(
    executor: Executor,
    approver: Caller,
    proposalChannel: Channel,
    change: Change,
  ): Promise<void> {
    await this.#write(
      executor,
      { accountId: approver.accountId },
      [proposalChannel, approver.channel],
      change,
    )
  }

  /**
   * Reads the audit log, newest entry first. A system admin may read the whole log or any
   * project's part of it; a project's admins and read-write members may read that project's part
   * only (FR-138). Everyone else is refused before the service checks anything else they sent, so
   * a refusal tells nothing about what the log holds. (Through the REST API, a query that fails
   * the route's schema is refused before it reaches the service; that tells nothing about the
   * log either.)
   */
  async readLog(caller: Caller, query: AuditQuery = {}): Promise<AuditEntry[]> {
    await this.#requireReader(caller, query.projectId)
    const limit = query.limit ?? DEFAULT_PAGE_SIZE
    if (!Number.isInteger(limit) || limit < 1 || limit > MAX_PAGE_SIZE) {
      throw new ServiceError(
        'invalid',
        `The limit must be a whole number from 1 to ${MAX_PAGE_SIZE}`,
      )
    }
    if (query.before !== undefined && !(Number.isSafeInteger(query.before) && query.before > 0)) {
      throw new ServiceError('invalid', 'The entry to read before must be a positive whole number')
    }

    const conditions: SQL[] = []
    if (query.projectId !== undefined) conditions.push(eq(auditLog.projectId, query.projectId))
    if (query.before !== undefined) conditions.push(lt(auditLog.id, query.before))
    const rows = await this.#db
      .select({
        id: auditLog.id,
        at: auditLog.at,
        accountId: auditLog.actorAccountId,
        username: accounts.username,
        githubLogin: auditLog.actorGithubLogin,
        channels: auditLog.channels,
        projectId: auditLog.projectId,
        action: auditLog.action,
        subjectType: auditLog.subjectType,
        subjectId: auditLog.subjectId,
        details: auditLog.details,
      })
      .from(auditLog)
      .leftJoin(accounts, eq(accounts.id, auditLog.actorAccountId))
      .where(and(...conditions))
      .orderBy(desc(auditLog.id))
      .limit(limit)
    return rows.map((row) => ({
      id: row.id,
      at: row.at,
      by:
        row.accountId !== null && row.username !== null
          ? { accountId: row.accountId, username: row.username }
          : { githubLogin: row.githubLogin ?? '' },
      channels: row.channels,
      projectId: row.projectId,
      action: row.action,
      subject: { type: row.subjectType, id: row.subjectId },
      details: row.details,
    }))
  }

  async #write(
    executor: Executor,
    actor: { accountId: string } | { githubLogin: string },
    channels: Channel[],
    change: Change,
  ): Promise<void> {
    await executor.insert(auditLog).values({
      actorAccountId: 'accountId' in actor ? actor.accountId : null,
      actorGithubLogin: 'githubLogin' in actor ? actor.githubLogin : null,
      channels,
      projectId: change.projectId ?? null,
      action: change.action,
      subjectType: change.subject.type,
      subjectId: change.subject.id,
      details: change.details ?? {},
    })
  }

  async #requireReader(caller: Caller, projectId: string | undefined): Promise<void> {
    if (await isSystemAdmin(this.#db, caller.accountId)) {
      if (projectId !== undefined && !isUuid(projectId)) {
        throw new ServiceError('invalid', 'The project id is not valid')
      }
      return
    }
    const role =
      projectId !== undefined && isUuid(projectId) && isUuid(caller.accountId)
        ? await this.#roles.roleOf(caller.accountId, projectId)
        : undefined
    // Someone with no role in the project cannot see it at all (FR-017).
    if (projectId !== undefined && role === undefined) throw notVisible()
    if (role === undefined || !READER_ROLES.has(role)) {
      throw new ServiceError(
        'forbidden',
        projectId === undefined
          ? 'Only system admins can read the whole audit log'
          : "Only system admins and the project's admins and read-write members can read its audit log",
      )
    }
  }
}

function actorOf(actor: Actor): { accountId: string } | { githubLogin: string } {
  return 'githubLogin' in actor
    ? { githubLogin: actor.githubLogin }
    : { accountId: actor.accountId }
}

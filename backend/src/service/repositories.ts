import { and, asc, count, eq, sql } from 'drizzle-orm'
import type { Database, Executor } from '../db/client.ts'
import { accounts, repositories, repositoryAdmins } from '../db/schema.ts'
import { checkRepository } from '../github/app-tokens.ts'
import {
  GitHubUnavailableError,
  type ReachedRepository,
  type RepositoryReach,
} from '../github/repository-reach.ts'
import type { AuditLogService } from './audit.ts'
import type { Caller } from './caller.ts'
import { violates } from './db-errors.ts'
import { ServiceError } from './errors.ts'
import { isSystemAdmin, isUuid } from './system-admins.ts'

/** An admin of a registered repository. */
export interface RepositoryAdmin {
  accountId: string
  username: string
}

/** A registered repository as the service layer hands it out, with its admins (FR-166). */
export interface RegisteredRepository {
  id: string
  /** GitHub's own id for the repository. */
  githubId: number
  /** The owner and name GitHub gave the repository when it was registered. */
  owner: string
  name: string
  /** By username. */
  admins: RepositoryAdmin[]
}

/** The unique index that keeps a repository from being registered twice (see the schema). */
const GITHUB_ID_INDEX = 'repositories_github_id_key'

const repositoryColumns = {
  id: repositories.id,
  githubId: repositories.githubId,
  owner: repositories.owner,
  name: repositories.name,
} as const

/** A repository GitHub cannot be asked about, until a GitHub client is given. */
const noReach: RepositoryReach = {
  reach: () => Promise.reject(new GitHubUnavailableError('The tool has no access to GitHub')),
}

/**
 * The repository registry (SC-019), the part of the service layer (DD-039) that keeps each
 * registered GitHub repository as an item of its own with its admins (FR-166). Anyone with an
 * account registers a repository the tool can reach on GitHub and nobody has registered yet, and
 * becomes its admin (FR-167); its admins add other admins (FR-174) and remove them or step down
 * (FR-176); a system admin changes any repository's admins (FR-169); and no change leaves a
 * repository without an admin, whoever makes it (FR-175). Each change is recorded in the audit log
 * in the same transaction (FR-116).
 *
 * Who may read the registry is not stated; every registered repository and its admins are shown
 * to anyone with an account, as groups are.
 */
export class RepositoryService {
  readonly #db: Database
  readonly #audit: AuditLogService
  readonly #github: RepositoryReach

  constructor(db: Database, audit: AuditLogService, github: RepositoryReach = noReach) {
    this.#db = db
    this.#audit = audit
    this.#github = github
  }

  /**
   * Registers the repository `owner/name` and makes the caller its admin, its only one (FR-167).
   * Refused unless the caller has an account; refused if the name is not a GitHub repository
   * name, if the repository is already registered, or if the tool cannot reach it on GitHub. The
   * repository is kept under the owner and name GitHub gives it.
   */
  async registerRepository(
    caller: Caller,
    repository: { owner: string; name: string },
  ): Promise<RegisteredRepository> {
    await this.#requireAccount(caller, 'Only people with an account can register a repository')
    const owner = repository.owner.trim()
    const name = repository.name.trim()
    try {
      checkRepository({ owner, name })
    } catch {
      throw new ServiceError('invalid', `${owner}/${name} is not a GitHub repository name`)
    }
    // Asked before GitHub, so a registered repository is refused as such even if the tool no
    // longer reaches it; the unique index on GitHub's id decides in the end.
    const [known] = await this.#db
      .select({ id: repositories.id })
      .from(repositories)
      .where(
        and(
          eq(sql`lower(${repositories.owner})`, owner.toLowerCase()),
          eq(sql`lower(${repositories.name})`, name.toLowerCase()),
        ),
      )
    if (known) throw alreadyRegistered(owner, name)

    let reached: ReachedRepository | undefined
    try {
      reached = await this.#github.reach({ owner, name })
    } catch (error) {
      if (error instanceof GitHubUnavailableError) {
        throw new ServiceError(
          'unavailable',
          `GitHub could not tell whether the tool can reach ${owner}/${name}; try again later`,
        )
      }
      throw error
    }
    if (reached === undefined) {
      throw new ServiceError(
        'invalid',
        `The tool cannot reach ${owner}/${name} on GitHub: its GitHub App is not installed on it, its token is not given it, or it does not exist`,
      )
    }
    const found = reached
    try {
      return await this.#db.transaction(async (tx) => {
        const [created] = await tx
          .insert(repositories)
          .values({ ...found, registeredBy: caller.accountId })
          .returning({ id: repositories.id })
        if (!created) throw new Error('The new repository was not returned')
        await tx
          .insert(repositoryAdmins)
          .values({ repositoryId: created.id, accountId: caller.accountId })
        await this.#audit.record(tx, caller, {
          action: 'repository.registered',
          subject: { type: 'repository', id: created.id },
          details: { repository: `${found.owner}/${found.name}`, githubId: found.githubId },
        })
        return this.#read(tx, created.id)
      })
    } catch (error) {
      if (violates(error, GITHUB_ID_INDEX)) throw alreadyRegistered(found.owner, found.name)
      throw error
    }
  }

  /** Every registered repository with its admins, by owner and name, to anyone with an account. */
  async listRepositories(caller: Caller): Promise<RegisteredRepository[]> {
    await this.#requireAccount(caller, 'Only people with an account can see the repositories')
    const rows = await this.#db
      .select(repositoryColumns)
      .from(repositories)
      .orderBy(
        asc(sql`lower(${repositories.owner})`),
        asc(sql`lower(${repositories.name})`),
        asc(repositories.id),
      )
    const admins = await this.#adminsOf(this.#db)
    return rows.map((row) => ({ ...row, admins: admins.get(row.id) ?? [] }))
  }

  /** A registered repository with its admins, to anyone with an account. */
  async getRepository(caller: Caller, repositoryId: string): Promise<RegisteredRepository> {
    await this.#requireAccount(caller, 'Only people with an account can see the repositories')
    return this.#read(this.#db, repositoryId)
  }

  /**
   * Makes the account `accountId` an admin of the repository, if it is not one already, and hands
   * back the repository. Allowed to the repository's admins (FR-174) and to system admins
   * (FR-169), who do not become its admins by it.
   */
  async addAdmin(
    caller: Caller,
    repositoryId: string,
    accountId: string,
  ): Promise<RegisteredRepository> {
    await this.#requireAccount(
      caller,
      "Only people with an account can change a repository's admins",
    )
    return this.#db.transaction(async (tx) => {
      const repository = await this.#lockForAdminChange(tx, caller, repositoryId)
      const [account] = isUuid(accountId)
        ? await tx
            .select({ id: accounts.id, username: accounts.username })
            .from(accounts)
            .where(eq(accounts.id, accountId))
        : []
      if (!account) throw new ServiceError('not-found', 'There is no such account')
      const added = await tx
        .insert(repositoryAdmins)
        .values({ repositoryId, accountId })
        .onConflictDoNothing()
        .returning({ accountId: repositoryAdmins.accountId })
      if (added.length > 0) {
        await this.#audit.record(tx, caller, {
          action: 'repository.admin-added',
          subject: { type: 'repository', id: repositoryId },
          details: { repository: repository.fullName, accountId, username: account.username },
        })
      }
      return this.#read(tx, repositoryId)
    })
  }

  /**
   * Removes the account `accountId` as an admin of the repository: another admin, or the caller
   * stepping down (FR-176). Allowed to the repository's admins and to system admins (FR-169);
   * refused to everyone, system admins included, if it would leave the repository without an
   * admin (FR-175).
   */
  async removeAdmin(caller: Caller, repositoryId: string, accountId: string): Promise<void> {
    await this.#requireAccount(
      caller,
      "Only people with an account can change a repository's admins",
    )
    await this.#db.transaction(async (tx) => {
      // The repository's row is locked, so two admins removing each other at once cannot both
      // succeed and leave it with none.
      const repository = await this.#lockForAdminChange(tx, caller, repositoryId)
      const admins = await this.#adminsOf(tx, repositoryId)
      const current = admins.get(repositoryId) ?? []
      const removed = current.find((admin) => admin.accountId === accountId)
      if (!removed) {
        throw new ServiceError('not-found', 'That person is not an admin of this repository')
      }
      if (current.length === 1) {
        throw new ServiceError(
          'conflict',
          `${repository.fullName} cannot be left without an admin: make someone else its admin first`,
        )
      }
      await tx
        .delete(repositoryAdmins)
        .where(
          and(
            eq(repositoryAdmins.repositoryId, repositoryId),
            eq(repositoryAdmins.accountId, accountId),
          ),
        )
      await this.#audit.record(tx, caller, {
        action: 'repository.admin-removed',
        subject: { type: 'repository', id: repositoryId },
        details: { repository: repository.fullName, accountId, username: removed.username },
      })
    })
  }

  /**
   * Locks the repository's row for a change of its admins, and refuses the caller unless they are
   * one of its admins or a system admin. A repository that does not exist is not found.
   */
  async #lockForAdminChange(
    tx: Executor,
    caller: Caller,
    repositoryId: string,
  ): Promise<{ fullName: string }> {
    const [repository] = isUuid(repositoryId)
      ? await tx
          .select({ owner: repositories.owner, name: repositories.name })
          .from(repositories)
          .where(eq(repositories.id, repositoryId))
          .for('update')
      : []
    if (!repository) throw new ServiceError('not-found', 'There is no such repository')
    const [own] = await tx
      .select({ n: count() })
      .from(repositoryAdmins)
      .where(
        and(
          eq(repositoryAdmins.repositoryId, repositoryId),
          eq(repositoryAdmins.accountId, caller.accountId),
        ),
      )
    if (own?.n === 0 && !(await isSystemAdmin(tx, caller.accountId))) {
      throw new ServiceError(
        'forbidden',
        "Only the repository's admins and system admins can change its admins",
      )
    }
    return { fullName: `${repository.owner}/${repository.name}` }
  }

  async #read(executor: Executor, repositoryId: string): Promise<RegisteredRepository> {
    const [repository] = isUuid(repositoryId)
      ? await executor
          .select(repositoryColumns)
          .from(repositories)
          .where(eq(repositories.id, repositoryId))
      : []
    if (!repository) throw new ServiceError('not-found', 'There is no such repository')
    const admins = await this.#adminsOf(executor, repositoryId)
    return { ...repository, admins: admins.get(repositoryId) ?? [] }
  }

  /** The admins of the repository, or of every repository when none is given, by username. */
  async #adminsOf(
    executor: Executor,
    repositoryId?: string,
  ): Promise<Map<string, RepositoryAdmin[]>> {
    const byRepository = new Map<string, RepositoryAdmin[]>()
    const rows = await executor
      .select({
        repositoryId: repositoryAdmins.repositoryId,
        accountId: repositoryAdmins.accountId,
        username: accounts.username,
      })
      .from(repositoryAdmins)
      .innerJoin(accounts, eq(accounts.id, repositoryAdmins.accountId))
      .where(
        repositoryId === undefined ? undefined : eq(repositoryAdmins.repositoryId, repositoryId),
      )
      .orderBy(asc(accounts.username), asc(repositoryAdmins.accountId))
    for (const { repositoryId: of, ...admin } of rows) {
      const list = byRepository.get(of)
      if (list) list.push(admin)
      else byRepository.set(of, [admin])
    }
    return byRepository
  }

  async #requireAccount(caller: Caller, refusal: string): Promise<void> {
    const [account] = isUuid(caller.accountId)
      ? await this.#db
          .select({ id: accounts.id })
          .from(accounts)
          .where(eq(accounts.id, caller.accountId))
      : []
    if (!account) throw new ServiceError('forbidden', refusal)
  }
}

function alreadyRegistered(owner: string, name: string): ServiceError {
  return new ServiceError('conflict', `${owner}/${name} is already registered`)
}

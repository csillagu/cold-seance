import { eq } from 'drizzle-orm'
import type { Database } from '../db/client.ts'
import { accounts } from '../db/schema.ts'
import type { AuditLogService } from './audit.ts'
import type { Caller } from './caller.ts'
import { violates } from './db-errors.ts'
import { ServiceError } from './errors.ts'
import { isSystemAdmin, isUuid } from './system-admins.ts'

/** A person's account in the tool and the GitHub account it is linked to, if any. */
export interface GitHubLink {
  accountId: string
  /** The GitHub account's name, as it was given; null until linked. */
  githubLogin: string | null
}

/**
 * What a GitHub account's name can be: letters, digits and single hyphens, neither first nor
 * last, at most 39 characters, as GitHub allows them.
 */
const GITHUB_LOGIN = /^[A-Za-z0-9](?:[A-Za-z0-9]|-(?=[A-Za-z0-9])){0,38}$/

/** The unique index that links one GitHub account to at most one account (see the schema). */
const GITHUB_LOGIN_INDEX = 'accounts_github_login_key'

/**
 * The GitHub account link, the part of the service layer through which a person, or a system admin
 * for them, links the person's account in the tool to their GitHub account, given by its name
 * (FR-135, SRC-202) (SC-054). Only the person and system admins may read or change the link. Each
 * change is recorded in the audit log (FR-116).
 */
export class GitHubLinkService {
  readonly #db: Database
  readonly #audit: AuditLogService

  constructor(db: Database, audit: AuditLogService) {
    this.#db = db
    this.#audit = audit
  }

  /**
   * Links the account `accountId` to the GitHub account named `login`, replacing a link it has.
   * Refused unless the caller is that person or a system admin; refused if the name is not one
   * GitHub allows, if there is no such account, or if another account is linked to that GitHub
   * account already.
   */
  async link(caller: Caller, accountId: string, login: string): Promise<GitHubLink> {
    await this.#requireSelfOrSystemAdmin(caller, accountId, 'link')
    const githubLogin = login.trim()
    if (!GITHUB_LOGIN.test(githubLogin)) {
      throw new ServiceError(
        'invalid',
        'A GitHub account name has at most 39 letters, digits and single hyphens, and starts and ends with a letter or digit',
      )
    }
    try {
      return await this.#db.transaction(async (tx) => {
        const [previous] = await tx
          .select({ githubLogin: accounts.githubLogin })
          .from(accounts)
          .where(eq(accounts.id, accountId))
          .for('update')
        if (!previous) throw new ServiceError('not-found', 'There is no such account')
        if (previous.githubLogin === githubLogin) return { accountId, githubLogin }
        await tx.update(accounts).set({ githubLogin }).where(eq(accounts.id, accountId))
        await this.#audit.record(tx, caller, {
          action: 'account.github-linked',
          subject: { type: 'account', id: accountId },
          details: { githubLogin, previous: previous.githubLogin },
        })
        return { accountId, githubLogin }
      })
    } catch (error) {
      if (violates(error, GITHUB_LOGIN_INDEX)) {
        throw new ServiceError(
          'conflict',
          `The GitHub account ${githubLogin} is already linked to another account`,
        )
      }
      throw error
    }
  }

  /** The GitHub account the account `accountId` is linked to. Only the person and system admins may read it. */
  async linkOf(caller: Caller, accountId: string): Promise<GitHubLink> {
    await this.#requireSelfOrSystemAdmin(caller, accountId, 'read')
    const [account] = await this.#db
      .select({ githubLogin: accounts.githubLogin })
      .from(accounts)
      .where(eq(accounts.id, accountId))
    if (!account) throw new ServiceError('not-found', 'There is no such account')
    return { accountId, githubLogin: account.githubLogin }
  }

  /** Refused before anything else is checked, so a refusal tells nothing about other accounts. */
  async #requireSelfOrSystemAdmin(
    caller: Caller,
    accountId: string,
    doing: 'link' | 'read',
  ): Promise<void> {
    if (caller.accountId === accountId && isUuid(accountId)) return
    if (!(await isSystemAdmin(this.#db, caller.accountId))) {
      throw new ServiceError(
        'forbidden',
        doing === 'link'
          ? "Only the person themselves and system admins can link a person's GitHub account"
          : "Only the person themselves and system admins can read a person's GitHub account link",
      )
    }
    if (!isUuid(accountId)) throw new ServiceError('not-found', 'There is no such account')
  }
}

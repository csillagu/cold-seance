import { createHash, randomBytes } from 'node:crypto'
import { and, asc, eq } from 'drizzle-orm'
import type { Database } from '../db/client.ts'
import { apiTokens } from '../db/schema.ts'
import type { AuditLogService } from './audit.ts'
import type { Caller } from './caller.ts'
import { ServiceError } from './errors.ts'
import { isUuid } from './system-admins.ts'

/** What every token's secret starts with, so a leaked one can be recognised for what it is. */
export const TOKEN_PREFIX = 'cst_'

/** The random bytes in a token's secret: 256 bits, so it cannot be guessed. */
const SECRET_BYTES = 32

/** An API token as the service layer hands it out: never with its secret or the secret's hash. */
export interface ApiToken {
  id: string
  createdAt: Date
  /** When the token stops working; never when not given. */
  expiresAt: Date | null
}

/** A token just created, with its secret, which is shown this once and never again. */
export interface CreatedApiToken {
  token: ApiToken
  secret: string
}

const columns = {
  id: apiTokens.id,
  createdAt: apiTokens.createdAt,
  expiresAt: apiTokens.expiresAt,
} as const

/**
 * The hash a token's secret is stored as (DD-048). The secret is 256 random bits, so a fast hash
 * is enough to keep it from being recovered from the database, and it can be checked on every
 * request without the cost of a password hash.
 */
export function hashSecret(secret: string): string {
  return createHash('sha256').update(secret, 'utf8').digest('hex')
}

/**
 * Personal access token management, the part of the service layer through which each person
 * creates, lists and revokes their own API tokens (DD-048) (SC-016). A token's secret is random,
 * shown once when the token is created, and stored only as its hash; a token may have an expiry
 * date; a revoked token is deleted, so it stops working at once. Everyone manages only their own
 * tokens. Each change is recorded in the audit log (FR-116), never with the secret.
 */
export class ApiTokenService {
  readonly #db: Database
  readonly #audit: AuditLogService
  readonly #now: () => Date

  constructor(db: Database, audit: AuditLogService, now: () => Date = () => new Date()) {
    this.#db = db
    this.#audit = audit
    this.#now = now
  }

  /**
   * Creates a token for the caller, with an expiry date if one is given, and answers it with its
   * secret. Refused if the caller has no account, or if the expiry date is not a valid date in the
   * future.
   */
  async createToken(caller: Caller, options: { expiresAt?: Date } = {}): Promise<CreatedApiToken> {
    if (!isUuid(caller.accountId)) {
      throw new ServiceError('forbidden', 'Only people with an account can create a token')
    }
    const { expiresAt } = options
    if (expiresAt !== undefined) {
      if (Number.isNaN(expiresAt.getTime())) {
        throw new ServiceError('invalid', 'The expiry date is not a valid date')
      }
      if (expiresAt.getTime() <= this.#now().getTime()) {
        throw new ServiceError('invalid', 'The expiry date must be in the future')
      }
    }
    const secret = TOKEN_PREFIX + randomBytes(SECRET_BYTES).toString('base64url')
    const token = await this.#db.transaction(async (tx) => {
      const [row] = await tx
        .insert(apiTokens)
        .values({
          accountId: caller.accountId,
          secretHash: hashSecret(secret),
          expiresAt: expiresAt ?? null,
        })
        .returning(columns)
      if (!row) throw new Error('The new token was not returned')
      await this.#audit.record(tx, caller, {
        action: 'api-token.created',
        subject: { type: 'api-token', id: row.id },
        details: { expiresAt: row.expiresAt?.toISOString() ?? null },
      })
      return row
    })
    return { token, secret }
  }

  /** The caller's own tokens, oldest first, without their secrets. */
  async listTokens(caller: Caller): Promise<ApiToken[]> {
    if (!isUuid(caller.accountId)) return []
    return this.#db
      .select(columns)
      .from(apiTokens)
      .where(eq(apiTokens.accountId, caller.accountId))
      .orderBy(asc(apiTokens.createdAt), asc(apiTokens.id))
  }

  /**
   * Revokes one of the caller's tokens: it is deleted, so it stops working at once. Refused as not
   * found if the caller has no such token, whether it does not exist or is someone else's, so a
   * refusal tells nothing about other people's tokens.
   */
  async revokeToken(caller: Caller, tokenId: string): Promise<void> {
    if (!isUuid(tokenId) || !isUuid(caller.accountId)) {
      throw new ServiceError('not-found', 'You have no such token')
    }
    await this.#db.transaction(async (tx) => {
      const [revoked] = await tx
        .delete(apiTokens)
        .where(and(eq(apiTokens.id, tokenId), eq(apiTokens.accountId, caller.accountId)))
        .returning({ id: apiTokens.id })
      if (!revoked) throw new ServiceError('not-found', 'You have no such token')
      await this.#audit.record(tx, caller, {
        action: 'api-token.revoked',
        subject: { type: 'api-token', id: revoked.id },
      })
    })
  }
}

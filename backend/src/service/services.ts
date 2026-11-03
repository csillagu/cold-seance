import type { Database } from '../db/client.ts'
import { AccountService } from './accounts.ts'
import { AuditLogService } from './audit.ts'

/**
 * The one service layer (DD-039): every module of it, over one database. The REST API, and later
 * the MCP server, call these and nothing else, so the same rules hold through every channel.
 * Each backend block adds its module here.
 */
export interface Services {
  accounts: AccountService
  audit: AuditLogService
}

export function createServices(db: Database): Services {
  // The audit log first: every module that changes something records the change in it (SC-013).
  const audit = new AuditLogService(db)
  return { accounts: new AccountService(db, audit), audit }
}

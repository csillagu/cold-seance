import type { Database } from '../db/client.ts'
import { AccountService } from './accounts.ts'

/**
 * The one service layer (DD-039): every module of it, over one database. The REST API, and later
 * the MCP server, call these and nothing else, so the same rules hold through every channel.
 * Each backend block adds its module here.
 */
export interface Services {
  accounts: AccountService
}

export function createServices(db: Database): Services {
  return { accounts: new AccountService(db) }
}

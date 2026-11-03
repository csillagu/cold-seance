import type { Database } from '../db/client.ts'
import { AccountService } from './accounts.ts'
import { ApiTokenService } from './api-tokens.ts'
import { AuditLogService } from './audit.ts'
import { ProjectRoleService } from './project-roles.ts'

/**
 * The one service layer (DD-039): every module of it, over one database. The REST API, and later
 * the MCP server, call these and nothing else, so the same rules hold through every channel.
 * Each backend block adds its module here.
 */
export interface Services {
  accounts: AccountService
  apiTokens: ApiTokenService
  audit: AuditLogService
  projectRoles: ProjectRoleService
}

export function createServices(db: Database): Services {
  // The audit log first: every module that changes something records the change in it (SC-013).
  // The audit log decides who may read it by project role, which the role store answers.
  const roles = {
    roleOf: (accountId: string, projectId: string) => projectRoles.roleOf(accountId, projectId),
  }
  const audit = new AuditLogService(db, roles)
  const projectRoles = new ProjectRoleService(db, audit)
  return {
    accounts: new AccountService(db, audit),
    apiTokens: new ApiTokenService(db, audit),
    audit,
    projectRoles,
  }
}

import type { Database } from '../db/client.ts'
import { AccountService } from './accounts.ts'
import { ApiTokenService } from './api-tokens.ts'
import { AuditLogService } from './audit.ts'
import { GitHubLinkService } from './github-links.ts'
import { ProjectRoleService } from './project-roles.ts'
import { ProjectService } from './projects.ts'
import { SessionService } from './sessions.ts'
import { TaskRelationService } from './task-relations.ts'
import { TaskService } from './tasks.ts'
import { ViewReadFilter } from './view-filter.ts'

/**
 * The one service layer (DD-039): every module of it, over one database. The REST API, and later
 * the MCP server, call these and nothing else, so the same rules hold through every channel.
 * Each backend block adds its module here.
 */
export interface Services {
  accounts: AccountService
  apiTokens: ApiTokenService
  audit: AuditLogService
  githubLinks: GitHubLinkService
  projectRoles: ProjectRoleService
  projects: ProjectService
  sessions: SessionService
  tasks: TaskService
  taskRelations: TaskRelationService
  /** The filter every view passes the tasks it would show through (SC-050). */
  viewFilter: ViewReadFilter
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
    githubLinks: new GitHubLinkService(db, audit),
    projectRoles,
    projects: new ProjectService(db, audit, projectRoles),
    sessions: new SessionService(db),
    tasks: new TaskService(db, audit, projectRoles),
    taskRelations: new TaskRelationService(db, audit, projectRoles),
    viewFilter: new ViewReadFilter(projectRoles),
  }
}

import type { Database } from '../db/client.ts'
import type { RepositoryReach } from '../github/repository-reach.ts'
import { AccountService } from './accounts.ts'
import { ApiTokenService } from './api-tokens.ts'
import { AuditLogService } from './audit.ts'
import { CalendarService } from './calendars.ts'
import { GitHubLinkService } from './github-links.ts'
import { GroupService } from './groups.ts'
import { ProjectRoleService } from './project-roles.ts'
import { ProjectService } from './projects.ts'
import { RepositoryService } from './repositories.ts'
import { SessionService } from './sessions.ts'
import { TaskRelationService } from './task-relations.ts'
import { TaskStatusService, type Today } from './task-status.ts'
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
  /** The calendars, capacities and absences (SC-008). */
  calendars: CalendarService
  githubLinks: GitHubLinkService
  groups: GroupService
  projectRoles: ProjectRoleService
  projects: ProjectService
  /** The registered GitHub repositories and their admins (SC-019). */
  repositories: RepositoryService
  sessions: SessionService
  tasks: TaskService
  taskRelations: TaskRelationService
  taskStatus: TaskStatusService
  /** The filter every view passes the tasks it would show through (SC-050). */
  viewFilter: ViewReadFilter
}

/** What the service layer can be given besides its database. */
export interface ServiceOptions {
  /** Today's date, `YYYY-MM-DD`; the deployment's local date when not given (SC-003). */
  today?: Today
  /**
   * Whether the tool reaches a repository on GitHub (SC-019); without it, the registry refuses
   * every registration as GitHub being unavailable.
   */
  github?: RepositoryReach
}

export function createServices(db: Database, options: ServiceOptions = {}): Services {
  // The audit log first: every module that changes something records the change in it (SC-013).
  // The audit log decides who may read it by project role, which the role store answers.
  const roles = {
    roleOf: (accountId: string, projectId: string) => projectRoles.roleOf(accountId, projectId),
  }
  const audit = new AuditLogService(db, roles)
  const projectRoles = new ProjectRoleService(db, audit)
  const viewFilter = new ViewReadFilter(projectRoles)
  return {
    accounts: new AccountService(db, audit),
    apiTokens: new ApiTokenService(db, audit),
    audit,
    calendars: new CalendarService(db, audit, projectRoles),
    githubLinks: new GitHubLinkService(db, audit),
    groups: new GroupService(db, audit),
    projectRoles,
    projects: new ProjectService(db, audit, projectRoles),
    repositories: new RepositoryService(db, audit, options.github),
    sessions: new SessionService(db),
    tasks: new TaskService(db, audit, projectRoles),
    taskRelations: new TaskRelationService(db, audit, projectRoles, viewFilter),
    taskStatus: new TaskStatusService(db, audit, projectRoles, options.today),
    viewFilter,
  }
}

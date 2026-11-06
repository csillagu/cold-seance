import type { Database } from '../db/client.ts'
import type { RepositoryReach } from '../github/repository-reach.ts'
import { AccountService } from './accounts.ts'
import { ApiTokenService } from './api-tokens.ts'
import { AuditLogService } from './audit.ts'
import { BaselineService } from './baselines.ts'
import { CalendarService } from './calendars.ts'
import { DailyPersonLoadService } from './daily-person-load.ts'
import { GanttExportService } from './gantt-export.ts'
import { GitHubLinkService } from './github-links.ts'
import { GroupService, groupRoles } from './groups.ts'
import type { PlanningChanges } from './planning-changes.ts'
import { ProjectRepositoryService } from './project-repositories.ts'
import { ProjectRoleService } from './project-roles.ts'
import { ProjectService } from './projects.ts'
import { ReceivingProjectService } from './receiving-projects.ts'
import { RedFlagService } from './red-flags.ts'
import { RepositoryService } from './repositories.ts'
import { SessionService } from './sessions.ts'
import { TaskCancellationService } from './task-cancellation.ts'
import { TaskRelationService } from './task-relations.ts'
import { TaskRepositoryService } from './task-repository.ts'
import { TaskStatusService, type Today } from './task-status.ts'
import { TaskService } from './tasks.ts'
import { VarianceService } from './variance.ts'
import { ViewReadFilter } from './view-filter.ts'
import { ViolationService } from './violations.ts'

/**
 * The one service layer (DD-039): every module of it, over one database. The REST API, and later
 * the MCP server, call these and nothing else, so the same rules hold through every channel.
 * Each backend block adds its module here.
 */
export interface Services {
  accounts: AccountService
  apiTokens: ApiTokenService
  audit: AuditLogService
  /** The named snapshots of a project's planned dates (SC-009). */
  baselines: BaselineService
  /** The calendars, capacities and absences (SC-008). */
  calendars: CalendarService
  /** Each person's load on each day, across all projects (SC-006). */
  dailyLoad: DailyPersonLoadService
  /** A project's Gantt exported as a Mermaid gantt chart for GitHub markdown (SC-021). */
  ganttExport: GanttExportService
  githubLinks: GitHubLinkService
  groups: GroupService
  /** Which projects pull issues from which repositories, with their requests (SC-110). */
  projectRepositories: ProjectRepositoryService
  projectRoles: ProjectRoleService
  projects: ProjectService
  /** Each repository's one receiving project (SC-111). */
  receivingProjects: ReceivingProjectService
  /** The red flags currently raised, with when each appeared (SC-043). */
  redFlags: RedFlagService
  /** The registered GitHub repositories and their admins (SC-019). */
  repositories: RepositoryService
  sessions: SessionService
  tasks: TaskService
  /** Cancelling a task, which passes its blockers on to the tasks it blocked (SC-038). */
  taskCancellation: TaskCancellationService
  taskRelations: TaskRelationService
  /** Which repository a task is assigned to (SC-036). */
  taskRepository: TaskRepositoryService
  taskStatus: TaskStatusService
  /** Each task's variance against a baseline, computed when asked (SC-044). */
  variance: VarianceService
  /** The filter every view passes the tasks it would show through (SC-050). */
  viewFilter: ViewReadFilter
  /** The violations shown in red at milestones and dependencies (SC-007). */
  violations: ViolationService
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
  /**
   * Told of each task whose planning, as it is mirrored to GitHub, changed, and of each task
   * assigned to a repository or cancelled: the GitHub planning mirror (SC-022), with the issue
   * creator (SC-060) and the not-planned closer (SC-061). Without it, nothing reaches GitHub.
   */
  planningChanges?: PlanningChanges
}

export function createServices(db: Database, options: ServiceOptions = {}): Services {
  // The audit log first: every module that changes something records the change in it (SC-013).
  // The audit log decides who may read it by project role, which the role store answers.
  const roles = {
    roleOf: (accountId: string, projectId: string) => projectRoles.roleOf(accountId, projectId),
  }
  const audit = new AuditLogService(db, roles)
  // The roles people hold through groups count wherever a project role decides (FR-111).
  const projectRoles = new ProjectRoleService(db, audit, groupRoles)
  const viewFilter = new ViewReadFilter(projectRoles)
  const groups = new GroupService(db, audit, projectRoles)
  const projectRepositories = new ProjectRepositoryService(db, audit, projectRoles)
  const calendars = new CalendarService(db, audit, projectRoles)
  const changes = options.planningChanges
  return {
    accounts: new AccountService(db, audit),
    apiTokens: new ApiTokenService(db, audit),
    audit,
    baselines: new BaselineService(db, audit, projectRoles),
    calendars,
    dailyLoad: new DailyPersonLoadService(db, viewFilter, calendars),
    ganttExport: new GanttExportService(db, projectRoles),
    githubLinks: new GitHubLinkService(db, audit, changes),
    groups,
    projectRepositories,
    projectRoles,
    projects: new ProjectService(db, audit, projectRoles, groups),
    receivingProjects: new ReceivingProjectService(db, audit, projectRoles, projectRepositories),
    redFlags: new RedFlagService(db, projectRoles),
    repositories: new RepositoryService(db, audit, options.github),
    sessions: new SessionService(db),
    tasks: new TaskService(db, audit, projectRoles, changes),
    taskCancellation: new TaskCancellationService(db, audit, projectRoles, changes),
    taskRelations: new TaskRelationService(db, audit, projectRoles, viewFilter, changes),
    taskRepository: new TaskRepositoryService(
      db,
      audit,
      projectRoles,
      projectRepositories,
      changes,
    ),
    taskStatus: new TaskStatusService(db, audit, projectRoles, options.today),
    variance: new VarianceService(db, projectRoles),
    viewFilter,
    violations: new ViolationService(db, projectRoles),
  }
}

import type { Database } from '../db/client.ts'
import type { RepositoryReach } from '../github/repository-reach.ts'
import { AccountService } from './accounts.ts'
import { ApiTokenService } from './api-tokens.ts'
import { AuditLogService } from './audit.ts'
import { BaselineService } from './baselines.ts'
import { CalendarService } from './calendars.ts'
import { DailyPersonLoadService } from './daily-person-load.ts'
import { GanttExportService } from './gantt-export.ts'
import { GitHubIssueTaskService } from './github-issue-tasks.ts'
import { GitHubLinkService } from './github-links.ts'
import { GroupService, groupRoles } from './groups.ts'
import { NotificationService } from './notifications.ts'
import type { PlanningChanges } from './planning-changes.ts'
import { ProjectRepositoryService } from './project-repositories.ts'
import { ProjectRoleService } from './project-roles.ts'
import { ProjectService } from './projects.ts'
import { ProposalApprovalService } from './proposal-approval.ts'
import { ProposalConflictService } from './proposal-conflicts.ts'
import { ProposalEditService } from './proposal-edits.ts'
import { ProposalPreviewService } from './proposal-preview.ts'
import { ProposalService } from './proposals.ts'
import { ReceivingProjectService } from './receiving-projects.ts'
import { RedFlagService } from './red-flags.ts'
import { RepositoryService } from './repositories.ts'
import { SavedViewService } from './saved-views.ts'
import { SeedingService, type SeedingSource } from './seeding.ts'
import { SessionService } from './sessions.ts'
import { TaskCancellationService } from './task-cancellation.ts'
import { TaskPeopleService } from './task-people.ts'
import { TaskRelationService } from './task-relations.ts'
import { TaskRepositoryService } from './task-repository.ts'
import { TaskStatusService, type Today } from './task-status.ts'
import { TaskService } from './tasks.ts'
import { UnassignedTaskRatingService } from './unassigned-ratings.ts'
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
  /** The tasks made from new GitHub issues (SC-023). */
  githubIssueTasks: GitHubIssueTaskService
  githubLinks: GitHubLinkService
  groups: GroupService
  /** The in-app notifications, and the subscriptions to projects and issues (SC-012). */
  notifications: NotificationService
  /** Which projects pull issues from which repositories, with their requests (SC-110). */
  projectRepositories: ProjectRepositoryService
  projectRoles: ProjectRoleService
  projects: ProjectService
  /** Approving each project's part of a proposal, which applies it once all are (SC-048). */
  proposalApproval: ProposalApprovalService
  /** A proposal's conflicts with edits made to the plan since (SC-047). */
  proposalConflicts: ProposalConflictService
  /** Editing a proposal one group at a time, and rejecting it (SC-045). */
  proposalEdits: ProposalEditService
  /** A proposal's live preview against the current plan (SC-011). */
  proposalPreview: ProposalPreviewService
  /** The proposals, each a set of grouped changes to the plan (SC-010). */
  proposals: ProposalService
  /** Each repository's one receiving project (SC-111). */
  receivingProjects: ReceivingProjectService
  /** The red flags currently raised, with when each appeared (SC-043). */
  redFlags: RedFlagService
  /** The registered GitHub repositories and their admins (SC-019). */
  repositories: RepositoryService
  /** The named Kanban and Gantt views kept in projects, groups or personally (SC-020). */
  savedViews: SavedViewService
  /** Seeding a project from GitHub repositories, all or nothing (SC-025). */
  seeding: SeedingService
  sessions: SessionService
  tasks: TaskService
  /** Cancelling a task, which passes its blockers on to the tasks it blocked (SC-038). */
  taskCancellation: TaskCancellationService
  /** Who a task's eligibility and assignment name, for the editors (SC-099, SC-100). */
  taskPeople: TaskPeopleService
  taskRelations: TaskRelationService
  /** Which repository a task is assigned to (SC-036). */
  taskRepository: TaskRepositoryService
  taskStatus: TaskStatusService
  /** The red, amber or green rating of each eligible but unassigned task by load (SC-041). */
  unassignedRatings: UnassignedTaskRatingService
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
  /** The current time; the system clock when not given. Proposals expire by it (SC-046). */
  now?: () => Date
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
  /**
   * Where the seeding importer reads repositories' issues from (SC-025): GitHub, through the GitHub
   * client. Without it, every seeding is refused as unavailable.
   */
  seeding?: SeedingSource
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
  const proposals = new ProposalService(db, audit, projectRoles, options.now)
  const tasks = new TaskService(db, audit, projectRoles, changes)
  const receivingProjects = new ReceivingProjectService(
    db,
    audit,
    projectRoles,
    projectRepositories,
  )
  const proposalPreview = new ProposalPreviewService(
    db,
    proposals,
    audit,
    projectRoles,
    viewFilter,
    projectRepositories,
    options.today,
  )
  return {
    accounts: new AccountService(db, audit),
    apiTokens: new ApiTokenService(db, audit),
    audit,
    baselines: new BaselineService(db, audit, projectRoles),
    calendars,
    dailyLoad: new DailyPersonLoadService(db, viewFilter, calendars),
    ganttExport: new GanttExportService(db, projectRoles),
    githubIssueTasks: new GitHubIssueTaskService(db, audit, projectRepositories, receivingProjects),
    githubLinks: new GitHubLinkService(db, audit, changes),
    groups,
    notifications: new NotificationService(db, audit, projectRoles),
    projectRepositories,
    projectRoles,
    projects: new ProjectService(db, audit, projectRoles, groups),
    proposalApproval: new ProposalApprovalService(
      db,
      audit,
      projectRoles,
      proposals,
      proposalPreview,
      viewFilter,
      projectRepositories,
      { changes, today: options.today, now: options.now },
    ),
    proposalConflicts: new ProposalConflictService(db, proposals),
    proposalEdits: new ProposalEditService(db, audit, projectRoles, proposals, options.now),
    proposalPreview,
    proposals,
    receivingProjects,
    redFlags: new RedFlagService(db, projectRoles),
    repositories: new RepositoryService(db, audit, options.github),
    savedViews: new SavedViewService(db, audit, projectRoles, tasks, viewFilter),
    seeding: new SeedingService(
      db,
      audit,
      projectRoles,
      projectRepositories,
      options.seeding,
      options.today,
    ),
    sessions: new SessionService(db),
    tasks,
    taskCancellation: new TaskCancellationService(db, audit, projectRoles, changes),
    taskPeople: new TaskPeopleService(db, tasks),
    taskRelations: new TaskRelationService(db, audit, projectRoles, viewFilter, changes),
    taskRepository: new TaskRepositoryService(
      db,
      audit,
      projectRoles,
      projectRepositories,
      changes,
    ),
    taskStatus: new TaskStatusService(db, audit, projectRoles, options.today),
    unassignedRatings: new UnassignedTaskRatingService(db, projectRoles),
    variance: new VarianceService(db, projectRoles),
    viewFilter,
    violations: new ViolationService(db, projectRoles),
  }
}

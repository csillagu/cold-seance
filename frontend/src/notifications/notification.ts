import { formatDay } from '../gantt/gantt-model.ts'

/** A task a notification names, or `null` where the reader cannot read its project. */
export type NotifiedTask = { id: string; projectId: string } | null

/** A notification as `GET /api/notifications` gives it (SC-012), newest first. */
export interface ApiNotification {
  id: string
  kind: 'red-flag' | 'proposal-waiting' | 'repository-request' | 'token-refused'
  createdAt: string
  detail: {
    flagKind?:
      | 'overload'
      | 'assignee-unavailable'
      | 'fixed-date-milestone-pushed'
      | 'cross-project-dependency'
    projectIds?: string[]
    accountId?: string
    date?: string
    task?: NotifiedTask
    blocker?: NotifiedTask
    start?: string
    blockerFinish?: string
    proposalId?: string
    requestId?: string
    project?: { id: string; name: string }
    repository?: { id: string; owner: string; name: string }
    requestedBy?: { accountId: string; username: string }
    function?: 'readIssues' | 'writeIssues' | 'projectsStatus'
  }
}

/**
 * What the list knows to name the ids of a notification by: project names, task titles and
 * usernames, from what the reader can read, and the reader's own account. An id it cannot name
 * is written in general words.
 */
export interface Names {
  me: string | undefined
  projects: ReadonlyMap<string, string>
  tasks: ReadonlyMap<string, string>
  people: ReadonlyMap<string, string>
}

/** A notification as the list shows it: what it tells, and where it leads, if anywhere. */
export interface NotificationView {
  id: string
  /** What it is about, in a word or two. */
  label: string
  text: string
  link: string | null
  createdAt: string
}

/** How each GitHub function is named. */
const FUNCTIONS = {
  readIssues: 'reading issues',
  writeIssues: 'writing to issues',
  projectsStatus: 'the Projects status field',
} as const

/** The ids of the projects a notification names: those it is raised in, and its tasks'. */
export function projectsNamed(notification: ApiNotification): string[] {
  const { detail } = notification
  const ids = new Set(detail.projectIds ?? [])
  if (detail.task) ids.add(detail.task.projectId)
  if (detail.blocker) ids.add(detail.blocker.projectId)
  return [...ids]
}

/** `ids`' names, joined in words: `Apollo and Borealis`. */
function projectList(ids: readonly string[], names: Names): string | null {
  const known = ids.flatMap((id) => {
    const name = names.projects.get(id)
    return name === undefined ? [] : [name]
  })
  if (known.length === 0) return null
  if (known.length === 1) return known[0] ?? null
  return `${known.slice(0, -1).join(', ')} and ${known.at(-1)}`
}

function taskName(task: NotifiedTask | undefined, names: Names, otherwise: string): string {
  if (!task) return otherwise
  return names.tasks.get(task.id) ?? otherwise
}

const on = (date: string | undefined) => (date ? formatDay(date, true) : 'a day')

/** A red flag in words, and the place it leads to. */
function redFlag(
  detail: ApiNotification['detail'],
  names: Names,
): { text: string; link: string | null } {
  const where = projectList(detail.projectIds ?? [], names)
  const inWhere = where ? ` in ${where}` : ''
  const taskLink = detail.task ? `/tasks/${encodeURIComponent(detail.task.id)}` : null
  switch (detail.flagKind) {
    case 'overload': {
      const person =
        detail.accountId === undefined
          ? 'Someone is'
          : detail.accountId === names.me
            ? 'You are'
            : `${names.people.get(detail.accountId) ?? 'Someone'} is`
      const project = detail.projectIds?.[0]
      return {
        text: `${person} overloaded on ${on(detail.date)}${inWhere}.`,
        link: project ? `/projects/${encodeURIComponent(project)}/load` : null,
      }
    }
    case 'assignee-unavailable':
      return {
        text: `${taskName(detail.task, names, 'A task')}${inWhere}: its assigned people cannot do it in its time.`,
        link: taskLink,
      }
    case 'fixed-date-milestone-pushed':
      return {
        text:
          `${taskName(detail.task, names, 'A fixed-date milestone')}${inWhere} is pushed past ` +
          `its date, as ${taskName(detail.blocker, names, 'a task it depends on')} finishes ` +
          `${on(detail.blockerFinish)}.`,
        link: taskLink,
      }
    case 'cross-project-dependency': {
      const blockerLink = detail.blocker ? `/tasks/${encodeURIComponent(detail.blocker.id)}` : null
      return {
        text:
          `${taskName(detail.task, names, 'A task of another project')} starts ` +
          `${on(detail.start)}, before ${taskName(detail.blocker, names, 'the milestone it depends on')} ` +
          `finishes ${on(detail.blockerFinish)}${inWhere}.`,
        link: taskLink ?? blockerLink,
      }
    }
    default:
      return { text: `A new red flag${inWhere}.`, link: null }
  }
}

/** A notification in words, as the list shows it. */
export function viewOf(notification: ApiNotification, names: Names): NotificationView {
  const { detail } = notification
  const base = { id: notification.id, createdAt: notification.createdAt }
  switch (notification.kind) {
    case 'red-flag':
      return { ...base, label: 'Red flag', ...redFlag(detail, names) }
    case 'proposal-waiting': {
      const where = projectList(detail.projectIds ?? [], names)
      return {
        ...base,
        label: 'Proposal',
        text: `A proposal${where ? ` changing ${where}` : ''} is waiting for your review.`,
        link: detail.proposalId ? `/proposals/${encodeURIComponent(detail.proposalId)}` : null,
      }
    }
    case 'repository-request': {
      const project = detail.project?.name ?? 'A project'
      const repository = detail.repository
        ? `${detail.repository.owner}/${detail.repository.name}`
        : 'a repository you are an admin of'
      const by = detail.requestedBy ? `, asked by ${detail.requestedBy.username}` : ''
      return {
        ...base,
        label: 'Repository request',
        text: `${project} asks to add ${repository}${by}.`,
        link: '/repository-requests',
      }
    }
    case 'token-refused': {
      const what = detail.function ? ` for ${FUNCTIONS[detail.function]}` : ''
      return {
        ...base,
        label: 'GitHub token',
        text:
          `GitHub refused the personal access token${what} as expired or revoked. It stops ` +
          'working until the tool is restarted with a new token.',
        link: null,
      }
    }
    default:
      return { ...base, label: 'Notification', text: 'A notification.', link: null }
  }
}

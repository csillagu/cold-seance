/** The caller's subscriptions, as `GET /api/subscriptions` gives them (SC-012). */
export interface Subscriptions {
  projects: { projectId: string; name: string; automatic: boolean }[]
  issues: {
    taskId: string
    projectId: string
    repository: { id: string; owner: string; name: string }
    number: number
  }[]
}

/** What a control subscribes to: a project, or the GitHub issue linked to a task. */
export type Subject =
  | { kind: 'project'; projectId: string; name: string }
  | { kind: 'issue'; taskId: string; number: number }

export type State = 'unknown' | 'none' | 'subscribed' | 'automatic' | 'failed'

/** The address of the subject's subscription in the REST API, below `/api`. */
export function subscriptionPath(subject: Subject): string {
  return subject.kind === 'project'
    ? `/subscriptions/projects/${encodeURIComponent(subject.projectId)}`
    : `/subscriptions/issues/${encodeURIComponent(subject.taskId)}`
}

/** Whether, and how, `subscriptions` holds the subject. */
export function stateOf(
  subscriptions: Subscriptions,
  subject: Subject,
): Exclude<State, 'unknown' | 'failed'> {
  if (subject.kind === 'project') {
    const found = subscriptions.projects.find((p) => p.projectId === subject.projectId)
    if (!found) return 'none'
    return found.automatic ? 'automatic' : 'subscribed'
  }
  return subscriptions.issues.some((i) => i.taskId === subject.taskId) ? 'subscribed' : 'none'
}

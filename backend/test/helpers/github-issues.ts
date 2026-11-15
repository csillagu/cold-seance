/**
 * The issues of the fake GitHub (`github.ts`): the parts of GitHub's REST API the GitHub planning
 * mirror (SC-022), the issue creator (SC-060), the not-planned closer (SC-061) and the change
 * handler (SC-023) and the seeding importer (SC-025) read and write: listing a repository's issues, creating an issue, its title, state and state reason, its
 * assignees and milestone, its parent and sub-issues, its blocked-by relations and the issues it
 * blocks, its events, and a repository's milestones; and, through GraphQL, an issue found by its
 * node id. Issues can also be created and deleted on it directly, as
 * someone would on GitHub; a deleted issue is answered as gone (410).
 */

/** An issue on the fake GitHub. */
export interface FakeIssue {
  /** GitHub's own id for it. */
  id: number
  /** Its GraphQL node id. */
  nodeId: string
  number: number
  /** `owner/name`, as the repository was created. */
  repository: string
  title: string
  state: 'open' | 'closed'
  /** Why it was closed, as GitHub names it (`completed`, `not_planned`), or `null`. */
  stateReason: string | null
  /** When it was last closed, as GitHub records it (an ISO timestamp), or `null` while open. */
  closedAt: string | null
  /** The GitHub login of whoever last closed it, as GitHub names them in `closed_by`, or `null`. */
  closedBy: string | null
  /** Its events, oldest first, as GitHub lists them: what happened, and the login of who did it. */
  events: { event: string; actor: string }[]
  /** Whether it is a pull request, which GitHub lists among a repository's issues. */
  pullRequest: boolean
  assignees: string[]
  /** The number of its repository's milestone it is in, if any. */
  milestone: number | undefined
  /** The id of its parent issue, if any. */
  parent: number | undefined
  /** The ids of the issues it is blocked by, in the order they were added. */
  blockedBy: number[]
  /** Its items in GitHub Projects, each in an option of the Project's status field, or none. */
  projectItems: FakeProjectItem[]
}

/** An issue's item in a GitHub Project. */
export interface FakeProjectItem {
  itemId: string
  projectId: string
  /** The option of the Project's status field the item is in, or null. */
  status: string | null
}

/** The options of each fake Project's status field. */
export const FAKE_STATUS_OPTIONS = ['Todo', 'In Progress', 'On Hold', 'Done'] as const

/** The name of each fake Project's status field. */
export const FAKE_STATUS_FIELD = 'Status'

export interface FakeMilestone {
  number: number
  title: string
  dueOn: string | null
}

export interface FakeIssues {
  /** Opens an issue in `owner/name`, which must exist on the fake GitHub. */
  createIssue(fullName: string, title?: string): FakeIssue
  /**
   * Deletes the issue `number` of `owner/name`, as a repository admin would on GitHub: it is gone
   * from its relations, and asking for it is answered with 410.
   */
  deleteIssue(fullName: string, number: number): void
  /**
   * Adds the issue to a GitHub Project (a new one unless `projectId` is given), in the status
   * option `status` or none, and answers its item.
   */
  addToProject(
    fullName: string,
    number: number,
    options?: { projectId?: string; status?: string | null },
  ): FakeProjectItem
  /** Answers a GraphQL call, or `undefined` if it is not one it knows. */
  graphql(query: string, variables: Record<string, unknown>): unknown
  /** The issues of `owner/name`, in the order they were made. */
  issuesOf(fullName: string): FakeIssue[]
  /** The issue `number` of `owner/name`. */
  issue(fullName: string, number: number): FakeIssue
  /** The issues whose parent is the issue `number` of `owner/name`, in the order they were made. */
  subIssues(fullName: string, number: number): FakeIssue[]
  /** The milestone `number` of `owner/name`. */
  milestone(fullName: string, number: number): FakeMilestone | undefined
  /**
   * Answers a request on the repository `key` (`owner/name`, lower case) below its path, or
   * `undefined` if it is not one of these routes.
   */
  handle(method: string, key: string, rest: string, body: unknown): Response | undefined
}

let nextIssueId = 9_000_000
let nextItem = 1

export function fakeIssues(
  repositoryOf: (key: string) => { owner: string; name: string } | undefined,
  apiUrl: string,
): FakeIssues {
  const issues = new Map<number, FakeIssue>()
  /** `key#number` of each deleted issue. */
  const deleted = new Set<string>()
  const milestones = new Map<string, FakeMilestone[]>()
  const counters = new Map<string, number>()

  const json = (status: number, payload?: unknown) =>
    payload === undefined
      ? new Response(null, { status })
      : new Response(JSON.stringify(payload), {
          status,
          headers: { 'content-type': 'application/json' },
        })
  const notFound = () => json(404, { message: 'Not Found' })

  const find = (key: string, number: number) =>
    [...issues.values()].find((i) => i.repository.toLowerCase() === key && i.number === number)

  const out = (issue: FakeIssue) => {
    const key = issue.repository.toLowerCase()
    const repo = repositoryOf(key)
    const milestone = (milestones.get(key) ?? []).find((m) => m.number === issue.milestone)
    return {
      id: issue.id,
      number: issue.number,
      title: issue.title,
      state: issue.state,
      state_reason: issue.stateReason,
      closed_at: issue.closedAt,
      closed_by: issue.closedBy === null ? null : { login: issue.closedBy },
      ...(issue.pullRequest ? { pull_request: { url: `${apiUrl}/pulls/${issue.number}` } } : {}),
      repository_url: `${apiUrl}/repos/${repo?.owner}/${repo?.name}`,
      assignees: issue.assignees.map((login) => ({ login })),
      milestone: milestone === undefined ? null : milestoneOut(milestone),
    }
  }
  const milestoneOut = (m: FakeMilestone) => ({ number: m.number, title: m.title, due_on: m.dueOn })

  const field = (name: string): unknown =>
    typeof body === 'object' && body !== null ? Reflect.get(body, name) : undefined
  let body: unknown

  return {
    createIssue(fullName, title = 'An issue') {
      const key = fullName.toLowerCase()
      if (repositoryOf(key) === undefined) throw new Error(`no repository ${fullName}`)
      const number = (counters.get(key) ?? 0) + 1
      counters.set(key, number)
      const issue: FakeIssue = {
        id: nextIssueId,
        nodeId: `I_${nextIssueId++}`,
        number,
        repository: fullName,
        title,
        state: 'open',
        stateReason: null,
        closedAt: null,
        closedBy: null,
        events: [],
        pullRequest: false,
        assignees: [],
        milestone: undefined,
        parent: undefined,
        blockedBy: [],
        projectItems: [],
      }
      issues.set(issue.id, issue)
      return issue
    },
    addToProject(fullName, number, options = {}) {
      const issue = this.issue(fullName, number)
      const n = nextItem++
      const item: FakeProjectItem = {
        itemId: `PVTI_${n}`,
        projectId: options.projectId ?? `PVT_${n}`,
        status: options.status ?? null,
      }
      issue.projectItems.push(item)
      return item
    },
    graphql(query, variables) {
      const fieldOf = (projectId: string) => ({
        id: `PVTSSF_${projectId}`,
        options: FAKE_STATUS_OPTIONS.map((name) => ({ id: `${projectId}:${name}`, name })),
      })
      const items = () => [...issues.values()].flatMap((issue) => issue.projectItems)
      if (query.includes('node(id:')) {
        const issue = [...issues.values()].find((i) => i.nodeId === variables['id'])
        const repo = issue && repositoryOf(issue.repository.toLowerCase())
        if (!issue || !repo) return { data: { node: null } }
        return {
          data: {
            node: {
              number: issue.number,
              repository: { name: repo.name, owner: { login: repo.owner } },
            },
          },
        }
      }
      if (query.includes('projectItems')) {
        const key = `${String(variables['owner'])}/${String(variables['name'])}`.toLowerCase()
        const issue = find(key, Number(variables['number']))
        if (!issue) return { data: { repository: { issue: null } } }
        return {
          data: {
            repository: {
              issue: {
                projectItems: {
                  nodes: issue.projectItems.map((item) => ({
                    id: item.itemId,
                    project: { id: item.projectId },
                    fieldValueByName:
                      item.status === null || variables['field'] !== FAKE_STATUS_FIELD
                        ? null
                        : { name: item.status, field: fieldOf(item.projectId) },
                  })),
                },
              },
            },
          },
        }
      }
      const item = items().find((i) => i.itemId === variables['itemId'])
      if (query.includes('updateProjectV2ItemFieldValue')) {
        if (!item) return { errors: [{ message: 'Could not resolve to a node' }] }
        const option = fieldOf(item.projectId).options.find((o) => o.id === variables['optionId'])
        if (!option) return { errors: [{ message: 'The option does not exist' }] }
        item.status = option.name
        return { data: { updateProjectV2ItemFieldValue: { projectV2Item: { id: item.itemId } } } }
      }
      if (query.includes('clearProjectV2ItemFieldValue')) {
        if (!item) return { errors: [{ message: 'Could not resolve to a node' }] }
        item.status = null
        return { data: { clearProjectV2ItemFieldValue: { projectV2Item: { id: item.itemId } } } }
      }
      return undefined
    },
    deleteIssue(fullName, number) {
      const issue = this.issue(fullName, number)
      issues.delete(issue.id)
      deleted.add(`${fullName.toLowerCase()}#${number}`)
      for (const other of issues.values()) {
        if (other.parent === issue.id) other.parent = undefined
        other.blockedBy = other.blockedBy.filter((id) => id !== issue.id)
      }
    },
    issuesOf(fullName) {
      const key = fullName.toLowerCase()
      return [...issues.values()].filter((i) => i.repository.toLowerCase() === key)
    },
    issue(fullName, number) {
      const issue = find(fullName.toLowerCase(), number)
      if (!issue) throw new Error(`no issue ${fullName}#${number}`)
      return issue
    },
    subIssues(fullName, number) {
      const parent = this.issue(fullName, number)
      return [...issues.values()].filter((i) => i.parent === parent.id)
    },
    milestone(fullName, number) {
      return (milestones.get(fullName.toLowerCase()) ?? []).find((m) => m.number === number)
    },
    handle(method, key, rest, requestBody) {
      body = requestBody
      const own = milestones.get(key) ?? []
      milestones.set(key, own)

      if (method === 'POST' && rest === '/milestones') {
        const title = field('title')
        if (typeof title !== 'string' || own.some((m) => m.title === title)) {
          return json(422, { message: 'Validation Failed' })
        }
        const dueOn = field('due_on')
        const milestone = {
          number: own.length + 1,
          title,
          dueOn: typeof dueOn === 'string' ? dueOn : null,
        }
        own.push(milestone)
        return json(201, milestoneOut(milestone))
      }
      const milestone = /^\/milestones\/(\d+)$/.exec(rest)
      if (milestone) {
        const found = own.find((m) => m.number === Number(milestone[1]))
        if (!found) return notFound()
        if (method === 'GET') return json(200, milestoneOut(found))
        if (method === 'PATCH') {
          const dueOn = field('due_on')
          if (typeof dueOn === 'string') found.dueOn = dueOn
          return json(200, milestoneOut(found))
        }
      }

      if (method === 'POST' && rest === '/issues') {
        const title = field('title')
        if (typeof title !== 'string' || title === '') {
          return json(422, { message: 'Validation Failed' })
        }
        const repo = repositoryOf(key)
        return json(201, out(this.createIssue(`${repo?.owner}/${repo?.name}`, title)))
      }

      if (method === 'GET' && rest === '/issues') {
        // Every issue, open and closed, as `state=all` asks; one page holds them all.
        return json(
          200,
          [...issues.values()].filter((i) => i.repository.toLowerCase() === key).map(out),
        )
      }

      const path = /^\/issues\/(\d+)(\/.*)?$/.exec(rest)
      if (!path) return undefined
      const issue = find(key, Number(path[1]))
      if (!issue && deleted.has(`${key}#${Number(path[1])}`)) {
        return json(410, { message: 'This issue was deleted' })
      }
      if (!issue) return notFound()
      const below = path[2] ?? ''
      const byId = (id: unknown) => (typeof id === 'number' ? issues.get(id) : undefined)

      if (below === '' && method === 'GET') return json(200, out(issue))
      if (below === '/events' && method === 'GET') {
        return json(
          200,
          issue.events.map((e) => ({ event: e.event, actor: { login: e.actor } })),
        )
      }
      if (below === '' && method === 'PATCH') {
        const assignees = field('assignees')
        if (Array.isArray(assignees)) issue.assignees = assignees.map(String)
        const state = field('state')
        if (state === 'closed') {
          const reason = field('state_reason')
          issue.state = 'closed'
          issue.stateReason = typeof reason === 'string' ? reason : 'completed'
          issue.closedAt = new Date().toISOString()
        } else if (state === 'open') {
          issue.state = 'open'
          issue.stateReason = null
          issue.closedAt = null
        }
        const number = field('milestone')
        if (number === null) issue.milestone = undefined
        else if (typeof number === 'number') {
          if (!own.some((m) => m.number === number)) return json(422, { message: 'Invalid' })
          issue.milestone = number
        }
        return json(200, out(issue))
      }
      if (below === '/parent' && method === 'GET') {
        const parent = issue.parent === undefined ? undefined : issues.get(issue.parent)
        return parent === undefined ? notFound() : json(200, out(parent))
      }
      if (below === '/sub_issues' && method === 'GET') {
        return json(200, [...issues.values()].filter((i) => i.parent === issue.id).map(out))
      }
      if (below === '/sub_issues' && method === 'POST') {
        const sub = byId(field('sub_issue_id'))
        if (!sub) return json(422, { message: 'Invalid sub-issue' })
        if (sub.parent !== undefined && field('replace_parent') !== true) {
          return json(422, { message: 'The sub-issue already has a parent' })
        }
        sub.parent = issue.id
        return json(201, out(issue))
      }
      if (below === '/sub_issue' && method === 'DELETE') {
        const sub = byId(field('sub_issue_id'))
        if (!sub || sub.parent !== issue.id) return notFound()
        sub.parent = undefined
        return json(200, out(issue))
      }
      if (below === '/dependencies/blocked_by' && method === 'GET') {
        return json(
          200,
          issue.blockedBy.flatMap((id) => {
            const blocker = issues.get(id)
            return blocker === undefined ? [] : [out(blocker)]
          }),
        )
      }
      if (below === '/dependencies/blocking' && method === 'GET') {
        return json(
          200,
          [...issues.values()].filter((other) => other.blockedBy.includes(issue.id)).map(out),
        )
      }
      if (below === '/dependencies/blocked_by' && method === 'POST') {
        const blocker = byId(field('issue_id'))
        if (!blocker || blocker.id === issue.id) return json(422, { message: 'Invalid issue' })
        if (!issue.blockedBy.includes(blocker.id)) issue.blockedBy.push(blocker.id)
        return json(201, out(blocker))
      }
      const unblock = /^\/dependencies\/blocked_by\/(\d+)$/.exec(below)
      if (unblock && method === 'DELETE') {
        const id = Number(unblock[1])
        if (!issue.blockedBy.includes(id)) return notFound()
        issue.blockedBy = issue.blockedBy.filter((other) => other !== id)
        const blocker = issues.get(id)
        return json(200, blocker === undefined ? {} : out(blocker))
      }
      return undefined
    },
  }
}

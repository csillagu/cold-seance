/**
 * The issues of the fake GitHub (`github.ts`): the parts of GitHub's REST API the GitHub planning
 * mirror (SC-022) reads and writes, an issue's assignees and milestone, its parent and sub-issues,
 * its blocked-by relations, and a repository's milestones. Issues are created on it directly, as
 * the test cases' "so it has issue #1" needs while the GitHub issue creator (SC-060) is not built.
 */

/** An issue on the fake GitHub. */
export interface FakeIssue {
  /** GitHub's own id for it. */
  id: number
  number: number
  /** `owner/name`, as the repository was created. */
  repository: string
  assignees: string[]
  /** The number of its repository's milestone it is in, if any. */
  milestone: number | undefined
  /** The id of its parent issue, if any. */
  parent: number | undefined
  /** The ids of the issues it is blocked by, in the order they were added. */
  blockedBy: number[]
}

export interface FakeMilestone {
  number: number
  title: string
  dueOn: string | null
}

export interface FakeIssues {
  /** Opens an issue in `owner/name`, which must exist on the fake GitHub. */
  createIssue(fullName: string): FakeIssue
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

export function fakeIssues(
  repositoryOf: (key: string) => { owner: string; name: string } | undefined,
  apiUrl: string,
): FakeIssues {
  const issues = new Map<number, FakeIssue>()
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
    createIssue(fullName) {
      const key = fullName.toLowerCase()
      if (repositoryOf(key) === undefined) throw new Error(`no repository ${fullName}`)
      const number = (counters.get(key) ?? 0) + 1
      counters.set(key, number)
      const issue: FakeIssue = {
        id: nextIssueId++,
        number,
        repository: fullName,
        assignees: [],
        milestone: undefined,
        parent: undefined,
        blockedBy: [],
      }
      issues.set(issue.id, issue)
      return issue
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

      const path = /^\/issues\/(\d+)(\/.*)?$/.exec(rest)
      if (!path) return undefined
      const issue = find(key, Number(path[1]))
      if (!issue) return notFound()
      const below = path[2] ?? ''
      const byId = (id: unknown) => (typeof id === 'number' ? issues.get(id) : undefined)

      if (below === '' && method === 'GET') return json(200, out(issue))
      if (below === '' && method === 'PATCH') {
        const assignees = field('assignees')
        if (Array.isArray(assignees)) issue.assignees = assignees.map(String)
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

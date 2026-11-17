import type { LiveSettings } from './settings.ts'

export interface Issue {
  number: number
  node_id: string
  title: string
  state: 'open' | 'closed'
  state_reason: string | null
  assignees: { login: string }[]
  milestone: { number: number; title: string; due_on: string | null } | null
}

export interface Comment {
  body: string
  user: { login: string; type: string }
}

/**
 * The test repository on GitHub, called with the suite's own personal access token: as the GitHub
 * user the test cases call `tc-writer` (and `tc-alice`), not as the deployment's App.
 */
export class GitHub {
  readonly #settings: LiveSettings
  readonly repository: string

  constructor(settings: LiveSettings) {
    this.#settings = settings
    this.repository = `${settings.repository.owner}/${settings.repository.name}`
  }

  async rest<T = unknown>(method: string, path: string, body?: unknown): Promise<T> {
    const response = await fetch(`https://api.github.com${path}`, {
      method,
      headers: {
        accept: 'application/vnd.github+json',
        authorization: `Bearer ${this.#settings.githubToken}`,
        'x-github-api-version': '2022-11-28',
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    const text = await response.text()
    if (!response.ok)
      throw new Error(`GitHub ${method} ${path} answered ${response.status}: ${text}`)
    const parsed: T = text === '' ? undefined : JSON.parse(text)
    return parsed
  }

  async graphql<T>(query: string, variables: Record<string, unknown>): Promise<T> {
    const answer = await this.rest<{ data?: T; errors?: { message: string }[] }>(
      'POST',
      '/graphql',
      { query, variables },
    )
    if (answer.errors?.length) {
      throw new Error(`GitHub GraphQL: ${answer.errors.map((e) => e.message).join('; ')}`)
    }
    return answer.data!
  }

  /** The login of the token's owner. */
  async login(): Promise<string> {
    return (await this.rest<{ login: string }>('GET', '/user')).login
  }

  issue(number: number): Promise<Issue> {
    return this.rest<Issue>('GET', `/repos/${this.repository}/issues/${number}`)
  }

  openIssue(title: string): Promise<Issue> {
    return this.rest<Issue>('POST', `/repos/${this.repository}/issues`, { title })
  }

  editIssue(number: number, change: Record<string, unknown>): Promise<Issue> {
    return this.rest<Issue>('PATCH', `/repos/${this.repository}/issues/${number}`, change)
  }

  subIssues(number: number): Promise<Issue[]> {
    return this.rest<Issue[]>('GET', `/repos/${this.repository}/issues/${number}/sub_issues`)
  }

  blockedBy(number: number): Promise<Issue[]> {
    return this.rest<Issue[]>(
      'GET',
      `/repos/${this.repository}/issues/${number}/dependencies/blocked_by`,
    )
  }

  comments(number: number): Promise<Comment[]> {
    return this.rest<Comment[]>(
      'GET',
      `/repos/${this.repository}/issues/${number}/comments?per_page=100`,
    )
  }

  /** Deletes an issue for good, which only an admin of the repository may. */
  async deleteIssue(number: number): Promise<void> {
    const { node_id } = await this.issue(number)
    await this.graphql(
      'mutation($id: ID!) { deleteIssue(input: { issueId: $id }) { clientMutationId } }',
      {
        id: node_id,
      },
    )
  }

  /** Deletes the repository's milestones whose title contains `text`. */
  async deleteMilestones(text: string): Promise<void> {
    const milestones = await this.rest<{ number: number; title: string }[]>(
      'GET',
      `/repos/${this.repository}/milestones?state=all&per_page=100`,
    )
    for (const milestone of milestones.filter((m) => m.title.includes(text))) {
      await this.rest('DELETE', `/repos/${this.repository}/milestones/${milestone.number}`)
    }
  }
}

/** The GitHub Project whose status field the deployment reads, and its started and on-hold options. */
export class StatusField {
  readonly github: GitHub
  readonly projectId: string
  readonly fieldId: string
  readonly options: { started: string; onHold: string }

  private constructor(
    github: GitHub,
    projectId: string,
    fieldId: string,
    options: { started: string; onHold: string },
  ) {
    this.github = github
    this.projectId = projectId
    this.fieldId = fieldId
    this.options = options
  }

  static async find(github: GitHub, settings: LiveSettings): Promise<StatusField> {
    const projectFields = `projectV2(number: $number) {
      id
      field(name: $field) { ... on ProjectV2SingleSelectField { id options { id name } } }
    }`
    const data = await github.graphql<{
      repositoryOwner: {
        projectV2?: {
          id: string
          field: { id: string; options: { id: string; name: string }[] } | null
        }
      } | null
    }>(
      `query($owner: String!, $number: Int!, $field: String!) {
        repositoryOwner(login: $owner) {
          ... on User { ${projectFields} }
          ... on Organization { ${projectFields} }
        }
      }`,
      {
        owner: settings.project.owner,
        number: settings.project.number,
        field: settings.statusField.name,
      },
    )
    const project = data.repositoryOwner?.projectV2
    if (!project) {
      throw new Error(
        `GitHub Project ${settings.project.owner}#${settings.project.number} not found`,
      )
    }
    if (!project.field?.id) {
      throw new Error(`The GitHub Project has no single-select field ${settings.statusField.name}`)
    }
    const option = (name: string) => {
      const found = project.field!.options.find((o) => o.name.toLowerCase() === name.toLowerCase())
      if (!found) throw new Error(`The field ${settings.statusField.name} has no option ${name}`)
      return found.id
    }
    return new StatusField(github, project.id, project.field.id, {
      started: option(settings.statusField.started),
      onHold: option(settings.statusField.onHold),
    })
  }

  /** Adds the issue to the Project, if it is not in it, and sets its status field to `option`. */
  async set(issue: Issue, option: 'started' | 'onHold'): Promise<void> {
    const added = await this.github.graphql<{ addProjectV2ItemById: { item: { id: string } } }>(
      'mutation($project: ID!, $issue: ID!) { addProjectV2ItemById(input: { projectId: $project, contentId: $issue }) { item { id } } }',
      { project: this.projectId, issue: issue.node_id },
    )
    await this.github.graphql(
      `mutation($project: ID!, $item: ID!, $field: ID!, $option: String!) {
        updateProjectV2ItemFieldValue(input: {
          projectId: $project, itemId: $item, fieldId: $field,
          value: { singleSelectOptionId: $option }
        }) { projectV2Item { id } }
      }`,
      {
        project: this.projectId,
        item: added.addProjectV2ItemById.item.id,
        field: this.fieldId,
        option: this.options[option],
      },
    )
  }
}

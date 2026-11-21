import { randomBytes } from 'node:crypto'
import { inject } from 'vitest'
import { GitHub, type Issue } from './github.ts'
import { deploymentSettings, eventually, localSettings, type LiveSettings } from './settings.ts'
import { Tool, type Task } from './tool.ts'

/**
 * One file's run of the live suite (SC-126, SC-128, DD-062, DD-063). The deployment is not fresh, so each run
 * works in projects of its own, named after it, and remembers what it made on GitHub. `cleanUp`
 * first removes the test repository from the run's projects, so that the tool leaves their issues
 * alone, then deletes those issues and the run's milestones on GitHub. The projects stay: the tool
 * cannot delete a project.
 */
export class LiveRun {
  /** Marks everything this run makes, in the tool and on GitHub. */
  readonly tag = `live-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-')}-${randomBytes(2).toString('hex')}`
  readonly #projects: string[] = []
  readonly #issues = new Set<number>()

  readonly settings: LiveSettings
  readonly tool: Tool
  readonly github: GitHub
  /** The test repository's id in the tool. */
  readonly repositoryId: string

  private constructor(settings: LiveSettings, tool: Tool, github: GitHub, repositoryId: string) {
    this.settings = settings
    this.tool = tool
    this.github = github
    this.repositoryId = repositoryId
  }

  /**
   * Signs in to the tool the command named, the deployment or the server the run started, and
   * registers the test repository there, if it is not yet. The first system admin registers it,
   * so they are its admin.
   */
  static async start(): Promise<LiveRun> {
    const target = inject('liveTarget')
    let settings: LiveSettings
    if (target === 'deployment') settings = deploymentSettings()
    else if (target === 'local') settings = localSettings(inject('liveServer'))
    else throw new Error('Run the live suite with npm run test:live or npm run test:live:local')
    const tool = await Tool.signIn(settings)
    const github = new GitHub(settings)
    const { owner, name } = settings.repository
    const registered = await tool.call<{ id: string; owner: string; name: string }[]>(
      'GET',
      '/repositories',
    )
    const found = registered.find(
      (r) =>
        r.owner.toLowerCase() === owner.toLowerCase() &&
        r.name.toLowerCase() === name.toLowerCase(),
    )
    const repositoryId =
      found?.id ??
      (await tool.call<{ id: string }>('POST', '/repositories', { owner, name }, 201)).id
    return new LiveRun(settings, tool, github, repositoryId)
  }

  /** A new project of this run, pulling issues from the test repository. */
  async project(label: string): Promise<string> {
    const { id } = await this.tool.call<{ id: string }>(
      'POST',
      '/projects',
      { name: `${label} ${this.tag}` },
      201,
    )
    this.#projects.push(id)
    const request = await this.tool.call<{ state: string }>(
      'POST',
      `/projects/${id}/repository-requests`,
      { repositoryId: this.repositoryId },
      201,
    )
    if (request.state !== 'approved') {
      throw new Error(`Adding the test repository to ${label} left it ${request.state}`)
    }
    return id
  }

  createTask(projectId: string, fields: Record<string, unknown>): Promise<Task> {
    return this.tool.call<Task>('POST', `/projects/${projectId}/tasks`, fields, 201)
  }

  /** Assigns a task to the test repository and waits for the issue the tool creates for it. */
  async assign(task: Task): Promise<Issue> {
    await this.tool.call('PUT', `/tasks/${task.id}/repository`, {
      repositoryId: this.repositoryId,
    })
    const linked = await eventually(
      async () => {
        const read = await this.tool.task(task.id)
        if (!read.githubIssue) throw new Error(`${task.title} has no issue yet`)
        return read.githubIssue
      },
      60_000,
      2_000,
    )
    this.#issues.add(linked.number)
    return this.github.issue(linked.number)
  }

  /** A task of the project, assigned to the test repository, with its issue. */
  async taskWithIssue(
    projectId: string,
    fields: Record<string, unknown> & { title: string },
  ): Promise<{ task: Task; issue: Issue }> {
    const task = await this.createTask(projectId, {
      ...fields,
      title: `${fields.title} ${this.tag}`,
    })
    const issue = await this.assign(task)
    return { task, issue }
  }

  /** Opens an issue on GitHub as the suite's GitHub user, to be deleted at the clean-up. */
  async openIssue(title: string): Promise<Issue> {
    const issue = await this.github.openIssue(`${title} ${this.tag}`)
    this.#issues.add(issue.number)
    return issue
  }

  /** Remembers an issue to delete at the clean-up. */
  track(number: number): void {
    this.#issues.add(number)
  }

  async cleanUp(): Promise<void> {
    const failures: unknown[] = []
    const attempt = async (step: () => Promise<unknown>) => {
      try {
        await step()
      } catch (error) {
        failures.push(error)
      }
    }
    for (const project of this.#projects) {
      await attempt(() =>
        this.tool.call('DELETE', `/projects/${project}/repositories/${this.repositoryId}`),
      )
    }
    for (const number of this.#issues) await attempt(() => this.github.deleteIssue(number))
    await attempt(() => this.github.deleteMilestones(this.tag))
    await attempt(() => this.tool.signOut())
    if (failures.length > 0) {
      throw new AggregateError(failures, `The clean-up of ${this.tag} failed in part`)
    }
  }
}

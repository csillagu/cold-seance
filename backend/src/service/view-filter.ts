import type { Executor } from '../db/client.ts'
import type { Caller } from './caller.ts'

/** Answers the projects a person can read: those they hold any role in (FR-106). */
export interface ReadableProjects {
  readableProjects(accountId: string, executor?: Executor): Promise<Set<string>>
}

/**
 * The view read filter of the service layer (DD-039, SC-050): every view, whoever saved it and
 * whatever it covers, passes the tasks it would show through here, and shows only those its
 * viewer can read now (FR-059). A view never grants access: two people opening the same view can
 * see different tasks, and someone who has lost their role in a project no longer sees its tasks.
 */
export class ViewReadFilter {
  readonly #projects: ReadableProjects

  constructor(projects: ReadableProjects) {
    this.#projects = projects
  }

  /**
   * The items, in their order, without those of a project the viewer cannot read. Each item
   * names the project it belongs to.
   */
  async readable<T extends { projectId: string }>(
    viewer: Caller,
    items: readonly T[],
    executor?: Executor,
  ): Promise<T[]> {
    if (items.length === 0) return []
    const readable = await this.#projects.readableProjects(viewer.accountId, executor)
    return items.filter((item) => readable.has(item.projectId))
  }
}

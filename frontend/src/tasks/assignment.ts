/** The AI share of an AI-only task: all of it (FR-149). */
export const AI_ONLY_SHARE = 100

/** The person load the UI offers for an AI-only task (FR-149, SC-100). */
export const AI_ONLY_DEFAULT_LOAD = 1

/** What the assignment editor reads of a task, as the REST API gives it. */
export interface AssignedTask {
  assignees: string[]
  loadOverrides: Record<string, number>
}

/**
 * An assignment as the editor builds it (SC-100): who will do the task, in order, each once, and
 * the load typed for each, `''` where the task's own load applies.
 */
export interface AssignmentDraft {
  assignees: string[]
  overrides: Record<string, string>
}

/** The changes to an assignment, as the REST API takes them (`PATCH /tasks/{id}`). */
export interface AssignmentChanges {
  assignees?: string[]
  loadOverrides?: Record<string, number>
}

export function assignmentDraftOf(task: AssignedTask): AssignmentDraft {
  const overrides: Record<string, string> = {}
  for (const person of task.assignees) {
    const load = task.loadOverrides[person]
    overrides[person] = load === undefined ? '' : String(load)
  }
  return { assignees: [...task.assignees], overrides }
}

/** A percentage typed into a field: `null` for an empty one, `NaN` for one that is no number. */
export function percentageOf(value: string): number | null {
  return value.trim() === '' ? null : Number(value)
}

/**
 * What saving the draft changes on the task, only what differs; or why it cannot be saved, as a
 * string. The overrides are sent whole, as the REST API replaces them all.
 */
export function assignmentChanges(
  task: AssignedTask,
  draft: AssignmentDraft,
  nameOf: (accountId: string) => string,
): AssignmentChanges | string {
  const loadOverrides: Record<string, number> = {}
  for (const person of draft.assignees) {
    const load = percentageOf(draft.overrides[person] ?? '')
    if (load === null) continue
    if (Number.isNaN(load)) return `The load of ${nameOf(person)} is not a number.`
    loadOverrides[person] = load
  }
  const changes: AssignmentChanges = {}
  if (draft.assignees.join() !== task.assignees.join()) changes.assignees = [...draft.assignees]
  if (!sameOverrides(loadOverrides, task.loadOverrides)) changes.loadOverrides = loadOverrides
  return changes
}

function sameOverrides(a: Record<string, number>, b: Record<string, number>): boolean {
  const keys = Object.keys(a)
  return keys.length === Object.keys(b).length && keys.every((key) => a[key] === b[key])
}

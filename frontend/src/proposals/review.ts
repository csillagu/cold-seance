import { formatDay } from '../gantt/gantt-model.ts'
import type { ApiProposal } from './proposal.ts'

/** A task of the live plan, as the proposal page reads it, with what a reviewer would see move. */
export interface PlanTask {
  id: string
  title: string
  plannedStart: string | null
  plannedFinish: string | null
}

/** What `POST /proposals/{id}/approval` answers (SC-048). */
export interface ApiApproval {
  outcome: 'confirm-again' | 'waiting-for-parts' | 'applied'
  proposal: ApiProposal
}

/** One project's part of a proposal, as the review controls show it. */
export interface Part {
  projectId: string
  project: string
  /** Who approved it since the proposal was last edited, or null while no one has. */
  approvedBy: string | null
}

/**
 * The parts of a proposal, one for each project it changes, in the order of its projects, each
 * with who approved it since its last edit (DD-025).
 */
export function partsOf(
  proposal: Pick<ApiProposal, 'approvals'>,
  projects: readonly { id: string; name: string }[],
  people: ReadonlyMap<string, string>,
): Part[] {
  return projects.map((project) => {
    const approval = proposal.approvals.find((a) => a.projectId === project.id)
    return {
      projectId: project.id,
      project: project.name,
      approvedBy:
        approval === undefined
          ? null
          : (people.get(approval.approvedBy) ?? 'someone who is not a member'),
    }
  })
}

const NONE = 'none'

function day(date: string | null): string {
  return date === null ? NONE : formatDay(date, true)
}

/**
 * What changed in the live plan between two reads of it, task by task, in words, as the reviewer
 * is shown it when they must confirm again (FR-078): a task added or removed, renamed, or whose
 * planned start or finish moved. `C: start 15 Mar 2027 → 16 Mar 2027`.
 */
export function planChanges(before: readonly PlanTask[], after: readonly PlanTask[]): string[] {
  const old = new Map(before.map((task) => [task.id, task]))
  const lines: string[] = []
  for (const task of after) {
    const was = old.get(task.id)
    old.delete(task.id)
    if (was === undefined) {
      lines.push(`${task.title}: added`)
      continue
    }
    const moves: string[] = []
    if (was.title !== task.title) moves.push(`renamed from ${was.title}`)
    if (was.plannedStart !== task.plannedStart) {
      moves.push(`start ${day(was.plannedStart)} → ${day(task.plannedStart)}`)
    }
    if (was.plannedFinish !== task.plannedFinish) {
      moves.push(`finish ${day(was.plannedFinish)} → ${day(task.plannedFinish)}`)
    }
    if (moves.length > 0) lines.push(`${task.title}: ${moves.join(', ')}`)
  }
  for (const task of old.values()) lines.push(`${task.title}: removed`)
  return lines
}

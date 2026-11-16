import { AI_ONLY_DEFAULT_LOAD, AI_ONLY_SHARE } from './assignment.ts'

/** The fields of a task the details editor sets (SC-098), as the REST API gives them. */
export interface DetailedTask {
  title: string
  description: string
  plannedStart: string | null
  plannedFinish: string | null
  durationWorkingDays: number | null
  effort: number | null
  aiShare: number | null
  personLoad: number | null
  milestone: unknown
}

/** What is typed into the details editor, each field as its text. */
export interface DetailsDraft {
  title: string
  description: string
  start: string
  duration: string
  finish: string
  effort: string
  aiShare: string
  /** The person load offered once the AI share is 100%; read only for a task becoming AI-only. */
  personLoad: string
}

/** The draft of a new task: every field empty, and 1% ready for an AI-only task (FR-149). */
export function newDetailsDraft(): DetailsDraft {
  return {
    title: '',
    description: '',
    start: '',
    duration: '',
    finish: '',
    effort: '',
    aiShare: '',
    personLoad: String(AI_ONLY_DEFAULT_LOAD),
  }
}

/** The draft of an existing task: its fields as they are. */
export function detailsDraftOf(task: DetailedTask): DetailsDraft {
  return {
    title: task.title,
    description: task.description,
    start: task.plannedStart ?? '',
    duration: task.durationWorkingDays?.toString() ?? '',
    finish: task.plannedFinish ?? '',
    effort: task.effort?.toString() ?? '',
    aiShare: task.aiShare?.toString() ?? '',
    personLoad: String(AI_ONLY_DEFAULT_LOAD),
  }
}

/** A number typed into a field, null for an empty one, NaN for one that is not a number. */
export function numberOf(value: string): number | null {
  return value.trim() === '' ? null : Number(value)
}

/** Whether the draft's AI share is 100%, so that the task is AI-only. */
export function draftIsAiOnly(draft: DetailsDraft): boolean {
  return numberOf(draft.aiShare) === AI_ONLY_SHARE
}

/**
 * Whether a new task's draft makes a milestone: a duration of 0 does (SRC-258), fixed to the
 * planned start if one is typed, floating if not (FR-212).
 */
export function draftIsMilestone(draft: DetailsDraft): boolean {
  return draft.duration.trim() !== '' && numberOf(draft.duration) === 0
}

/**
 * What is wrong with the draft before it is sent, or null: the task needs a title, and its
 * duration is a whole number of working days (DD-006). A new task (`creating`) may also have a
 * duration of 0, which makes it a milestone (FR-212); a task once made cannot become one (FR-194).
 * Anything else the REST API decides.
 */
export function detailsProblem(draft: DetailsDraft, creating = false): string | null {
  if (draft.title.trim() === '') return 'The task needs a title.'
  if (creating && draftIsMilestone(draft)) return null
  const duration = numberOf(draft.duration)
  if (duration !== null && (!Number.isInteger(duration) || duration < 1)) {
    return creating
      ? 'The duration is a whole number of working days: 0 for a milestone, or 1 or more.'
      : 'The duration is a whole number of working days, 1 or more.'
  }
  if (Number.isNaN(numberOf(draft.effort))) return 'The effort is not a number.'
  if (Number.isNaN(numberOf(draft.aiShare))) return 'The AI share is not a number.'
  if (draftIsAiOnly(draft) && Number.isNaN(numberOf(draft.personLoad))) {
    return 'The person load is not a number.'
  }
  return null
}

/**
 * How a milestone is asked for when it is created (FR-190): fixed to `date`, or floating when there
 * is none, so that the scheduler places it where what it is blocked by finishes (FR-195).
 */
export function milestoneOn(date: string):
  | { variant: 'fixed-date'; date: string }
  | {
      variant: 'floating'
    } {
  return date === '' ? { variant: 'floating' } : { variant: 'fixed-date', date }
}

/**
 * The fields a new task is created with (`POST /projects/{id}/tasks`): its title, and every other
 * field that was filled in. A task with no planned dates is created unscheduled (FR-003). A draft
 * with a duration of 0 is created as a milestone on its planned start, or floating without one,
 * with its title and description only (FR-212, FR-191).
 */
export function newTaskFields(draft: DetailsDraft): Record<string, unknown> {
  const fields: Record<string, unknown> = { title: draft.title }
  if (draft.description !== '') fields['description'] = draft.description
  if (draftIsMilestone(draft)) {
    fields['milestone'] = milestoneOn(draft.start)
    return fields
  }
  if (draft.start !== '') fields['plannedStart'] = draft.start
  const duration = numberOf(draft.duration)
  if (duration !== null) fields['durationWorkingDays'] = duration
  // With a duration the scheduler derives the finish; without one, it is the one typed.
  else if (draft.finish !== '') fields['plannedFinish'] = draft.finish
  const effort = numberOf(draft.effort)
  if (effort !== null) fields['effort'] = effort
  const aiShare = numberOf(draft.aiShare)
  if (aiShare !== null) fields['aiShare'] = aiShare
  if (aiShare === AI_ONLY_SHARE) fields['personLoad'] = numberOf(draft.personLoad)
  return fields
}

/**
 * The changes the draft makes to `task` (`PATCH /tasks/{id}`): only the fields that differ. A
 * milestone has its title and description here, nothing else. A task becoming AI-only is sent the
 * person load typed for it; an AI-only task's person load is changed in its assignment instead.
 */
export function detailsChanges(task: DetailedTask, draft: DetailsDraft): Record<string, unknown> {
  const changes: Record<string, unknown> = {}
  if (draft.title !== task.title) changes['title'] = draft.title
  if (draft.description !== task.description) changes['description'] = draft.description
  if (task.milestone) return changes
  if (draft.start !== (task.plannedStart ?? '')) changes['plannedStart'] = draft.start || null
  const duration = numberOf(draft.duration)
  if (duration !== task.durationWorkingDays) changes['durationWorkingDays'] = duration
  if (duration === null && draft.finish !== (task.plannedFinish ?? '')) {
    changes['plannedFinish'] = draft.finish || null
  }
  const effort = numberOf(draft.effort)
  if (effort !== task.effort) changes['effort'] = effort
  const aiShare = numberOf(draft.aiShare)
  if (aiShare !== task.aiShare) changes['aiShare'] = aiShare
  if (aiShare === AI_ONLY_SHARE && task.aiShare !== AI_ONLY_SHARE) {
    changes['personLoad'] = numberOf(draft.personLoad)
  }
  return changes
}

/** A repository a task can be assigned to: one its project pulls issues from (FR-141). */
export interface Repository {
  id: string
  owner: string
  name: string
}

/** How a repository is named on the screens. */
export function repositoryName(repository: Repository): string {
  return `${repository.owner}/${repository.name}`
}

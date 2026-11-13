/*
 * A proposal's changes in words, its conflicts in words (SC-070), and the drafts the proposal
 * editor (SC-071) edits a group of changes in. Pure functions, so that the screens and their tests
 * share them.
 */

import { formatDay } from '../gantt/gantt-model.ts'
import type { ApiChange, ApiConflict, ApiGroup, ApiTaskRef } from './proposal.ts'

/** How a field of a task is typed in the editor. */
type FieldKind = 'text' | 'long-text' | 'date' | 'number'

/** A task field a change gives, as the screens name it, and how the editor types it, if it does. */
interface FieldInfo {
  label: string
  kind?: FieldKind
}

/**
 * The task fields a proposal can give (FR-205), as the screens name them. Those with a `kind` are
 * typed in the editor; the others (who is assigned, the eligibility, the load overrides, the
 * milestone) are kept as the proposal gives them.
 */
export const TASK_FIELDS: Readonly<Record<string, FieldInfo>> = {
  title: { label: 'Title', kind: 'text' },
  description: { label: 'Description', kind: 'long-text' },
  plannedStart: { label: 'Planned start', kind: 'date' },
  plannedFinish: { label: 'Planned finish', kind: 'date' },
  durationWorkingDays: { label: 'Duration in working days', kind: 'number' },
  effort: { label: 'Effort', kind: 'number' },
  aiShare: { label: 'AI share in percent', kind: 'number' },
  personLoad: { label: 'Person load in percent', kind: 'number' },
  milestone: { label: 'Milestone' },
  eligibility: { label: 'Eligibility' },
  assignees: { label: 'Assigned people' },
  loadOverrides: { label: 'Load overrides' },
}

/** The other inputs a change can change, as the conflict detector names them (SC-047). */
const INPUT_LABELS: Readonly<Record<string, string>> = {
  parent: 'parent',
  blocker: 'blocker',
  status: 'status',
  repository: 'repository',
}

/** The statuses a proposal can set (FR-205), as the screens say them. */
export const STATUS_WORDS: Readonly<Record<string, string>> = {
  'in-progress': 'in progress',
  'on-hold': 'on hold',
  done: 'done',
}

/** How the screens name the tasks a proposal's changes name. */
export interface ChangeNames {
  /** The live plan's tasks, by id. */
  tasks: ReadonlyMap<string, string>
}

const lower = (label: string) => label.charAt(0).toLowerCase() + label.slice(1)

const fieldLabel = (name: string) => TASK_FIELDS[name]?.label ?? name

/** The name of an input of a change, as a conflict names it. */
export function inputLabel(name: string): string {
  return INPUT_LABELS[name] ?? lower(fieldLabel(name))
}

/** The title a create-task change of the group gives the new task `key`, if any. */
function newTaskTitle(groups: readonly ApiGroup[], key: string): string | undefined {
  for (const group of groups) {
    for (const change of group.changes) {
      if (change.kind === 'create-task' && change.key === key) {
        const title = change.fields?.title
        return typeof title === 'string' ? title : undefined
      }
    }
  }
  return undefined
}

/** The name of a task a change names: its title, or what is known of it. */
export function taskName(
  ref: ApiTaskRef | null | undefined,
  names: ChangeNames,
  groups: readonly ApiGroup[],
): string {
  if (ref?.taskId !== undefined) return names.tasks.get(ref.taskId) ?? 'a deleted task'
  if (ref?.newTask !== undefined)
    return newTaskTitle(groups, ref.newTask) ?? `new task ${ref.newTask}`
  return 'a task'
}

/** A value a change gives a field, in words. */
function valueWords(name: string, value: unknown): string {
  const kind = TASK_FIELDS[name]?.kind
  if (value === null) return 'none'
  if (kind === 'date' && typeof value === 'string') return formatDay(value, true)
  if ((kind === 'text' || kind === 'long-text') && typeof value === 'string') return `“${value}”`
  if (kind === 'number' && typeof value === 'number') return String(value)
  return 'as proposed'
}

/** What a change gives the fields of its task, in words: `planned start 8 Mar 2027`. */
function fieldsWords(fields: Record<string, unknown> | undefined): string {
  return Object.entries(fields ?? {})
    .map(([name, value]) => `${lower(fieldLabel(name))} ${valueWords(name, value)}`)
    .join(', ')
}

/** A change in words: `Change A: planned start 8 Mar 2027`. */
export function describeChange(
  change: ApiChange,
  names: ChangeNames,
  groups: readonly ApiGroup[],
): string {
  const task = taskName(change.task, names, groups)
  switch (change.kind) {
    case 'create-task': {
      const { title, ...rest } = change.fields ?? {}
      const named = typeof title === 'string' ? `“${title}”` : `new task ${change.key ?? ''}`
      const others = fieldsWords(rest)
      return `Create task ${named}${others ? `: ${others}` : ''}`
    }
    case 'update-task':
      return `Change ${task}: ${fieldsWords(change.fields)}`
    case 'set-parent':
      return change.parent
        ? `Put ${task} under ${taskName(change.parent, names, groups)}`
        : `Take ${task} out of its parent`
    case 'add-blocker':
      return `Make ${task} blocked by ${taskName(change.blocker, names, groups)}`
    case 'remove-blocker':
      return `Make ${task} no longer blocked by ${taskName(change.blocker, names, groups)}`
    case 'set-status':
      return `Set ${task} to ${STATUS_WORDS[change.status ?? ''] ?? change.status ?? ''}`
    case 'cancel-task':
      return `Cancel ${task}`
    case 'assign-repository':
      return `Assign ${task} to a repository`
    default:
      return `${change.kind} of ${task}`
  }
}

/** Why a change conflicts, in words (FR-076, DD-022). */
export function conflictWords(conflict: ApiConflict, names: ChangeNames): string {
  if (conflict.reason === 'deleted') {
    return 'Its task was deleted after the change was proposed.'
  }
  const task = names.tasks.get(conflict.taskId) ?? 'the task'
  const inputs = conflict.inputs.map(inputLabel)
  const what = inputs.length === 0 ? 'what it changes' : `the ${listWords(inputs)}`
  return `Someone else changed ${what} of ${task} after the change was proposed.`
}

/** `a`, `a and b`, `a, b and c`. */
function listWords(items: readonly string[]): string {
  if (items.length <= 1) return items.join('')
  return `${items.slice(0, -1).join(', ')} and ${items.at(-1) ?? ''}`
}

/** A field of a change being edited: what is typed for it, as the editor shows it. */
export interface FieldDraft {
  name: string
  label: string
  kind: FieldKind
  value: string
}

/** A change being edited. */
export interface ChangeDraft {
  change: ApiChange
  /** The fields typed in the editor, of a change that gives a task's fields. */
  fields: FieldDraft[]
  /** The fields kept as the proposal gives them, by label. */
  kept: string[]
  /** The status, of a set-status change. */
  status?: string
}

/** A group of changes being edited, as one (DD-023). */
export interface GroupDraft {
  groupId: string
  changes: ChangeDraft[]
}

/** A value as the editor types it, or `undefined` if it cannot type it. */
function typed(kind: FieldKind, value: unknown): string | undefined {
  if (value === null) return ''
  if (kind === 'number') return typeof value === 'number' ? String(value) : undefined
  return typeof value === 'string' ? value : undefined
}

/** The draft of a group, as the proposal gives it. */
export function groupDraft(group: ApiGroup): GroupDraft {
  return {
    groupId: group.id,
    changes: group.changes.map((change) => {
      const fields: FieldDraft[] = []
      const kept: string[] = []
      for (const [name, value] of Object.entries(change.fields ?? {})) {
        const kind = TASK_FIELDS[name]?.kind
        const text = kind === undefined ? undefined : typed(kind, value)
        if (kind === undefined || text === undefined) kept.push(fieldLabel(name))
        else fields.push({ name, label: fieldLabel(name), kind, value: text })
      }
      return change.kind === 'set-status'
        ? { change, fields, kept, status: change.status ?? '' }
        : { change, fields, kept }
    }),
  }
}

/** A draft that cannot be saved, and why. */
export class DraftError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'DraftError'
  }
}

/** The value a field draft gives, as the REST API takes it. */
function given(field: FieldDraft): unknown {
  const text =
    field.kind === 'text' || field.kind === 'long-text' ? field.value : field.value.trim()
  if (field.kind === 'text' || field.kind === 'long-text') return text
  if (text === '') return null
  if (field.kind === 'date') return text
  const number = Number(text)
  if (!Number.isFinite(number)) throw new DraftError(`${field.label} must be a number`)
  return number
}

/**
 * The group's whole new list of changes, as `PUT /proposals/{id}/groups/{groupId}` takes it: each
 * change as when a proposal is created, without the id and project the API adds to it, with the
 * typed fields and status in place of those the proposal gave. Throws a `DraftError` for a field
 * that cannot be given as it is typed.
 */
export function groupPayload(draft: GroupDraft): { changes: Record<string, unknown>[] } {
  return {
    changes: draft.changes.map(({ change, fields, status }) => {
      const { id: _id, projectId, ...rest } = change
      const payload: Record<string, unknown> =
        change.kind === 'create-task' ? { ...rest, projectId } : { ...rest }
      if (change.fields !== undefined) {
        const edited: Record<string, unknown> = { ...change.fields }
        for (const field of fields) edited[field.name] = given(field)
        payload.fields = edited
      }
      if (status !== undefined) payload.status = status
      return payload
    }),
  }
}

import { type FormEvent, useState } from 'react'
import type { KanbanTask } from '../kanban/kanban-model.ts'
import { PersonLoadField } from './AssignmentEditor.tsx'
import { AI_ONLY_DEFAULT_LOAD, AI_ONLY_SHARE } from './assignment.ts'
import '../kanban/kanban.css'

/** The fields the task editor changes, as the REST API takes them (`PATCH /tasks/{id}`). */
export interface TaskChanges {
  title?: string
  plannedStart?: string | null
  plannedFinish?: string | null
  durationWorkingDays?: number | null
  aiShare?: number | null
  personLoad?: number | null
  milestone?: { variant: 'fixed-date'; date: string }
  assignees?: string[]
}

/** A person who can be assigned to a task: someone with a role in the task's project. */
export interface Member {
  accountId: string
  username: string
}

/** A whole number or decimal typed into a field, null for an empty one. */
function numberOf(value: string): number | null {
  return value.trim() === '' ? null : Number(value)
}

/**
 * The fields of a task that a person sets, in the task dialog (#209). Only what was changed is
 * sent. A milestone has its date and title; a fixed-date milestone's date can be changed, a
 * floating one's is set by the scheduler.
 */
export function EditForm({
  task,
  members,
  onCancel,
  onSave,
}: {
  task: KanbanTask
  members: readonly Member[]
  onCancel: () => void
  onSave: (changes: TaskChanges) => Promise<void>
}) {
  const [title, setTitle] = useState(task.title)
  const [start, setStart] = useState(task.plannedStart ?? '')
  const [duration, setDuration] = useState(task.durationWorkingDays?.toString() ?? '')
  const [finish, setFinish] = useState(task.plannedFinish ?? '')
  const [aiShare, setAiShare] = useState(task.aiShare?.toString() ?? '')
  // An AI-only task's load can be any percentage; one becoming AI-only is offered 1% (FR-149).
  const wasAiOnly = task.aiShare === AI_ONLY_SHARE
  const [personLoad, setPersonLoad] = useState(
    wasAiOnly ? (task.personLoad?.toString() ?? '') : String(AI_ONLY_DEFAULT_LOAD),
  )
  const [milestoneDate, setMilestoneDate] = useState(task.milestone?.date ?? '')
  const [assignees, setAssignees] = useState<readonly string[]>(task.assignees)
  const [saving, setSaving] = useState(false)

  // Someone assigned who is no longer a direct member stays listed, so they can be removed.
  const choices: Member[] = [...members]
  for (const id of task.assignees) {
    if (!choices.some((member) => member.accountId === id)) {
      choices.push({ accountId: id, username: 'Not a member of this project' })
    }
  }

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    const changes: TaskChanges = {}
    if (title !== task.title) changes.title = title
    if (task.milestone) {
      if (
        task.milestone.variant === 'fixed-date' &&
        milestoneDate !== (task.milestone.date ?? '')
      ) {
        changes.milestone = { variant: 'fixed-date', date: milestoneDate }
      }
    } else {
      if (start !== (task.plannedStart ?? '')) changes.plannedStart = start || null
      const days = numberOf(duration)
      if (days !== task.durationWorkingDays) changes.durationWorkingDays = days
      // With a duration, the scheduler derives the finish; without one, it is set here.
      if (days === null && finish !== (task.plannedFinish ?? '')) {
        changes.plannedFinish = finish || null
      }
      const share = numberOf(aiShare)
      if (share !== task.aiShare) changes.aiShare = share
      if (share === AI_ONLY_SHARE) {
        const load = numberOf(personLoad)
        if (!wasAiOnly || load !== task.personLoad) changes.personLoad = load
      }
      if (assignees.join() !== task.assignees.join()) changes.assignees = [...assignees]
    }
    setSaving(true)
    try {
      await onSave(changes)
    } finally {
      setSaving(false)
    }
  }

  return (
    <form
      className="kanban__form"
      aria-label={`Edit ${task.title}`}
      onSubmit={(event) => void submit(event)}
    >
      <label className="kanban__field">
        Title
        <input value={title} required onChange={(event) => setTitle(event.target.value)} />
      </label>
      {task.milestone ? (
        task.milestone.variant === 'fixed-date' ? (
          <label className="kanban__field">
            Date
            <input
              type="date"
              value={milestoneDate}
              required
              onChange={(event) => setMilestoneDate(event.target.value)}
            />
          </label>
        ) : null
      ) : (
        <>
          <label className="kanban__field">
            Planned start
            <input type="date" value={start} onChange={(event) => setStart(event.target.value)} />
          </label>
          <label className="kanban__field">
            Duration in working days
            <input
              type="number"
              min="1"
              step="1"
              value={duration}
              onChange={(event) => setDuration(event.target.value)}
            />
          </label>
          {numberOf(duration) === null ? (
            <label className="kanban__field">
              Planned finish
              <input
                type="date"
                value={finish}
                onChange={(event) => setFinish(event.target.value)}
              />
            </label>
          ) : null}
          <label className="kanban__field">
            AI share in percent
            <input
              type="number"
              min="0"
              max="100"
              step="any"
              value={aiShare}
              onChange={(event) => setAiShare(event.target.value)}
            />
          </label>
          {numberOf(aiShare) === AI_ONLY_SHARE ? (
            <PersonLoadField
              className="kanban__field"
              value={personLoad}
              onChange={setPersonLoad}
            />
          ) : null}
          <fieldset className="kanban__field kanban__assignees">
            <legend>Assigned</legend>
            {choices.length === 0 ? <span className="kanban__muted">No one to assign</span> : null}
            {choices.map((member) => (
              <label key={member.accountId} className="kanban__check">
                <input
                  type="checkbox"
                  checked={assignees.includes(member.accountId)}
                  onChange={(event) =>
                    setAssignees((current) =>
                      event.target.checked
                        ? [...current, member.accountId]
                        : current.filter((id) => id !== member.accountId),
                    )
                  }
                />
                {member.username}
              </label>
            ))}
          </fieldset>
        </>
      )}
      <div className="kanban__actions">
        <button type="submit" className="kanban__button kanban__button--primary" disabled={saving}>
          Save
        </button>
        <button type="button" className="kanban__button" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  )
}

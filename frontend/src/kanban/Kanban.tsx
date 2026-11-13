import { type FormEvent, type ReactNode, useState } from 'react'
import { Link } from 'react-router'
import { ApiError } from '../api.ts'
import { avatarColour } from '../gantt/avatar.ts'
import type { PeopleById } from '../gantt/Gantt.tsx'
import { PersonLoadField } from '../tasks/AssignmentEditor.tsx'
import { AI_ONLY_DEFAULT_LOAD, AI_ONLY_SHARE } from '../tasks/assignment.ts'
import { formatDay, type TaskStatus } from '../gantt/gantt-model.ts'
import {
  COLUMNS,
  datesLabel,
  type KanbanCard,
  type KanbanColumn,
  type KanbanModel,
  type KanbanTask,
  movesFrom,
} from './kanban-model.ts'
import './kanban.css'

/** The fields an edit on a card changes, as the REST API takes them (`PATCH /tasks/{id}`). */
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

/** A person who can be assigned on a card: someone with a role in the task's project. */
export interface Member {
  accountId: string
  username: string
}

interface KanbanProps {
  /** What it is a Kanban of, for its accessible name. */
  name: string
  model: KanbanModel
  people: PeopleById
  /** The people who can be assigned to a task of each project, by project id. */
  members: ReadonlyMap<string, readonly Member[]>
  /** Moves a task to another status; rejects with the API's refusal. */
  onMove: (task: KanbanTask, status: TaskStatus) => Promise<void>
  /** Changes fields of a task; rejects with the API's refusal. */
  onEdit: (task: KanbanTask, changes: TaskChanges) => Promise<void>
}

/**
 * The Kanban view (SC-030, DD-042): one column per task status (FR-048), each card in the column
 * of its task's status, cancelled tasks in their own column (FR-129), and in each column the
 * unscheduled tasks at the bottom (FR-004, FR-145), as the approved design draws it (SRC-249).
 * Everything a card shows that a person sets can be changed on it (FR-053): its status by moving
 * it to another column, by dragging it or with its "Move to" control, and its fields with "Edit".
 * Every change goes to the REST API, which allows or refuses it by the viewer's role in the card's
 * project (FR-060); a refusal is shown on the card.
 */
export function Kanban({ name, model, people, members, onMove, onEdit }: KanbanProps) {
  const [dragged, setDragged] = useState<KanbanTask | null>(null)
  const [errors, setErrors] = useState<ReadonlyMap<string, string>>(new Map())

  const report = (task: KanbanTask, error: unknown) => {
    const message =
      error instanceof ApiError ? error.message : 'The change could not be saved. Try again.'
    setErrors((current) => new Map(current).set(task.id, message))
  }
  const clear = (task: KanbanTask) =>
    setErrors((current) => {
      const next = new Map(current)
      next.delete(task.id)
      return next
    })
  const move = (task: KanbanTask, status: TaskStatus) => {
    clear(task)
    onMove(task, status).catch((error: unknown) => report(task, error))
  }

  return (
    <div className="kanban" role="group" aria-label={name}>
      {model.columns.map((column) => (
        <Column
          key={column.status}
          column={column}
          dropAllowed={dragged !== null && movesFrom(dragged.status).includes(column.status)}
          onDrop={() => {
            if (dragged && movesFrom(dragged.status).includes(column.status)) {
              move(dragged, column.status)
            }
            setDragged(null)
          }}
        >
          {(card) => (
            <Card
              key={card.task.id}
              card={card}
              people={people}
              members={members.get(card.task.projectId) ?? []}
              error={errors.get(card.task.id) ?? null}
              onDragStart={() => setDragged(card.task)}
              onDragEnd={() => setDragged(null)}
              onMove={(status) => move(card.task, status)}
              onEdit={async (changes) => {
                clear(card.task)
                try {
                  await onEdit(card.task, changes)
                  return true
                } catch (error) {
                  report(card.task, error)
                  return false
                }
              }}
            />
          )}
        </Column>
      ))}
    </div>
  )
}

function Column({
  column,
  dropAllowed,
  onDrop,
  children,
}: {
  column: KanbanColumn
  dropAllowed: boolean
  onDrop: () => void
  children: (card: KanbanCard) => ReactNode
}) {
  const headingId = `kanban-column-${column.status}`
  const count = column.scheduled.length + column.unscheduled.length
  return (
    <section
      aria-labelledby={headingId}
      data-status={column.status}
      className={'kanban__column' + (dropAllowed ? ' kanban__column--drop' : '')}
      onDragOver={(event) => {
        if (dropAllowed) event.preventDefault()
      }}
      onDrop={(event) => {
        event.preventDefault()
        onDrop()
      }}
    >
      <h2 className="kanban__heading">
        <span className={`kanban__status kanban__status--${column.status}`} aria-hidden="true" />
        <span id={headingId}>{column.name}</span>
        <span className="kanban__count" aria-label={`${count} tasks`}>
          {count}
        </span>
      </h2>
      <ul className="kanban__cards" aria-label={`${column.name}, scheduled`}>
        {column.scheduled.map((card) => (
          <li key={card.task.id}>{children(card)}</li>
        ))}
      </ul>
      {column.unscheduled.length > 0 ? (
        <>
          <div role="separator" aria-label="Unscheduled" className="kanban__separator">
            Unscheduled
          </div>
          <ul className="kanban__cards" aria-label={`${column.name}, unscheduled`}>
            {column.unscheduled.map((card) => (
              <li key={card.task.id}>{children(card)}</li>
            ))}
          </ul>
        </>
      ) : null}
    </section>
  )
}

function Card({
  card,
  people,
  members,
  error,
  onDragStart,
  onDragEnd,
  onMove,
  onEdit,
}: {
  card: KanbanCard
  people: PeopleById
  members: readonly Member[]
  error: string | null
  onDragStart: () => void
  onDragEnd: () => void
  onMove: (status: TaskStatus) => void
  onEdit: (changes: TaskChanges) => Promise<boolean>
}) {
  const { task } = card
  const [editing, setEditing] = useState(false)
  const moves = movesFrom(task.status)
  const dates = datesLabel(task)

  return (
    <article
      aria-label={task.title}
      data-task-id={task.id}
      data-red={card.red}
      draggable={moves.length > 0 && !editing}
      onDragStart={(event) => {
        event.dataTransfer.setData('text/plain', task.id)
        event.dataTransfer.effectAllowed = 'move'
        onDragStart()
      }}
      onDragEnd={onDragEnd}
      className={
        'kanban__card' +
        (card.red ? ' kanban__card--red' : '') +
        (task.status === 'cancelled' ? ' kanban__card--cancelled' : '') +
        (task.status === 'done' ? ' kanban__card--done' : '')
      }
    >
      {card.project ? <div className="kanban__project">{card.project.name}</div> : null}
      {editing ? (
        <EditForm
          task={task}
          members={members}
          onCancel={() => setEditing(false)}
          onSave={async (changes) => {
            if (Object.keys(changes).length === 0 || (await onEdit(changes))) setEditing(false)
          }}
        />
      ) : (
        <>
          <div className="kanban__title">
            {task.milestone ? (
              <span
                className={
                  'kanban__diamond' +
                  (task.milestone.variant === 'floating' ? ' kanban__diamond--floating' : '')
                }
                aria-hidden="true"
              />
            ) : null}
            <span className="kanban__title-text">{task.title}</span>
          </div>
          <div className="kanban__tags">
            {task.milestone ? (
              <span className="kanban__tag">
                {task.milestone.variant === 'fixed-date' ? 'Fixed date' : 'Floating'}
              </span>
            ) : null}
            {dates ? (
              <span className="kanban__tag kanban__tag--mono" aria-label={`Planned ${dates}`}>
                {dates}
              </span>
            ) : (
              <span className="kanban__tag kanban__tag--empty">No dates</span>
            )}
            {task.aiShare ? (
              <span className="kanban__tag kanban__tag--accent">AI share {task.aiShare}%</span>
            ) : null}
            {!task.milestone && task.assignees.length === 0 ? (
              <span className="kanban__tag kanban__tag--empty">Unassigned</span>
            ) : null}
            {task.status === 'done' && task.actualFinish ? (
              <span className="kanban__tag kanban__tag--ok">
                Finished {formatDay(task.actualFinish)}
              </span>
            ) : null}
          </div>
          {card.note ? <div className="kanban__note">{card.note}</div> : null}
          {task.assignees.length > 0 ? (
            <div className="kanban__people" aria-label="Assigned">
              {task.assignees.map((id) => {
                const username = people.get(id)
                return (
                  <span
                    key={id}
                    className="kanban__avatar"
                    style={{ background: avatarColour(id) }}
                    title={username ?? 'Not a member of this project'}
                  >
                    {username ? username.slice(0, 2).toUpperCase() : '?'}
                  </span>
                )
              })}
            </div>
          ) : null}
          <div className="kanban__actions">
            <button
              type="button"
              className="kanban__button"
              aria-label={`Edit ${task.title}`}
              onClick={() => setEditing(true)}
            >
              Edit
            </button>
            <Link
              to={`/tasks/${encodeURIComponent(task.id)}`}
              className="kanban__button kanban__link"
              aria-label={`Open ${task.title}`}
            >
              Open
            </Link>
            {moves.length > 0 ? (
              <label className="kanban__move">
                <span className="kanban__hidden">Move {task.title} to</span>
                <select
                  value=""
                  onChange={(event) => {
                    const status = moves.find((move) => move === event.target.value)
                    if (status) onMove(status)
                  }}
                >
                  <option value="">Move to…</option>
                  {moves.map((status) => (
                    <option key={status} value={status}>
                      {COLUMNS.find((column) => column.status === status)!.name}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
          </div>
        </>
      )}
      {error ? (
        <p role="alert" className="kanban__error">
          {error}
        </p>
      ) : null}
    </article>
  )
}

/** A whole number or decimal typed into a field, null for an empty one. */
function numberOf(value: string): number | null {
  return value.trim() === '' ? null : Number(value)
}

/**
 * The form a card turns into for "Edit": the fields the card shows that a person sets. Only what
 * was changed is sent. A milestone has its date and title; a fixed-date milestone's date can be
 * changed, a floating one's is set by the scheduler. The Gantt's task editor uses it too (SC-067).
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

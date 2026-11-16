import { type ReactNode, useState } from 'react'
import { Link } from 'react-router'
import { ApiError } from '../api.ts'
import { avatarColour } from '../gantt/avatar.ts'
import type { PeopleById } from '../gantt/Gantt.tsx'
import { formatDay, type TaskStatus } from '../gantt/gantt-model.ts'
import {
  datesLabel,
  type KanbanCard,
  type KanbanColumn,
  type KanbanModel,
  type KanbanTask,
  movesFrom,
  type ProposedCard,
} from './kanban-model.ts'
import './kanban.css'

interface KanbanProps {
  /** What it is a Kanban of, for its accessible name. */
  name: string
  model: KanbanModel
  people: PeopleById
  /** Moves a task to another status; rejects with the API's refusal. */
  onMove: (task: KanbanTask, status: TaskStatus) => Promise<void>
  /** Opens the task dialog of a task: its title was clicked (#209). */
  onOpen: (task: KanbanTask) => void
}

/**
 * The Kanban view (SC-030, DD-042): one column per task status (FR-048), each card in the column
 * of its task's status, cancelled tasks in their own column (FR-129), and in each column the
 * unscheduled tasks at the bottom (FR-004, FR-145), as the approved design draws it (SRC-249).
 * Everything a card shows that a person sets can be changed from it (FR-053): its status by
 * dragging it to another column (#224), and the rest in the task dialog its title opens, the same
 * as every view's (#209). Every change goes to the REST API, which allows or refuses it by the
 * viewer's role in the card's project (FR-060); a refusal is shown on the card.
 *
 * What a proposal under review would change is shown as pending, apart from the live plan: on a
 * card, in a dashed box of its own, and a task it would create as a dashed card below the live
 * cards of its column, which cannot be moved or edited (FR-073).
 */
export function Kanban({ name, model, people, onMove, onOpen }: KanbanProps) {
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
          people={people}
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
              error={errors.get(card.task.id) ?? null}
              onDragStart={() => setDragged(card.task)}
              onDragEnd={() => setDragged(null)}
              onOpen={() => onOpen(card.task)}
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
  people,
  children,
}: {
  column: KanbanColumn
  dropAllowed: boolean
  onDrop: () => void
  people: PeopleById
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
      {column.proposed.length > 0 ? (
        <>
          <div role="separator" aria-label="Proposed" className="kanban__separator">
            Proposed, pending review
          </div>
          <ul className="kanban__cards" aria-label={`${column.name}, proposed`}>
            {column.proposed.map((card) => (
              <li key={`${card.proposalId}:${card.task.id}`}>
                <ProposedCardView card={card} people={people} />
              </li>
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
  error,
  onDragStart,
  onDragEnd,
  onOpen,
}: {
  card: KanbanCard
  people: PeopleById
  error: string | null
  onDragStart: () => void
  onDragEnd: () => void
  onOpen: () => void
}) {
  const { task } = card
  const draggable = movesFrom(task.status).length > 0
  const dates = datesLabel(task)

  return (
    <article
      aria-label={task.title}
      data-task-id={task.id}
      data-red={card.red}
      draggable={draggable}
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
        <button
          type="button"
          className="kanban__title-text kanban__title-button"
          aria-label={`Open ${task.title}`}
          onClick={onOpen}
        >
          {task.title}
        </button>
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
      {card.pending.map((change) => (
        <div
          key={change.proposalId}
          role="group"
          aria-label={`Pending change to ${task.title}`}
          data-proposal-id={change.proposalId}
          className="kanban__pending"
        >
          <div className="kanban__pending-title">Pending change</div>
          {change.lines.length === 0 ? (
            <div>Rescheduled as proposed</div>
          ) : (
            change.lines.map((line) => <div key={line}>{line}</div>)
          )}
        </div>
      ))}
      <People ids={task.assignees} people={people} />
      {error ? (
        <p role="alert" className="kanban__error">
          {error}
        </p>
      ) : null}
    </article>
  )
}

/** The avatars of the people assigned to a task, if any. */
function People({ ids, people }: { ids: readonly string[]; people: PeopleById }) {
  if (ids.length === 0) return null
  return (
    <div className="kanban__people" aria-label="Assigned">
      {ids.map((id) => {
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
  )
}

/**
 * The card of a task a proposal under review would create: dashed and marked as pending, as it is
 * not in the plan, with a link to review the proposal in place of the live cards' controls (FR-073).
 */
function ProposedCardView({ card, people }: { card: ProposedCard; people: PeopleById }) {
  const { task } = card
  const dates = datesLabel(task)
  return (
    <article
      aria-label={`${task.title}, proposed`}
      data-pending="true"
      data-proposal-id={card.proposalId}
      className="kanban__card kanban__card--proposed"
    >
      {card.project ? <div className="kanban__project">{card.project.name}</div> : null}
      <div className="kanban__title">
        <span className="kanban__title-text">{task.title}</span>
      </div>
      <div className="kanban__tags">
        <span className="kanban__tag kanban__tag--accent">Pending</span>
        {dates ? (
          <span className="kanban__tag kanban__tag--mono" aria-label={`Proposed ${dates}`}>
            {dates}
          </span>
        ) : (
          <span className="kanban__tag kanban__tag--empty">No dates</span>
        )}
      </div>
      <People ids={task.assignees} people={people} />
      <div className="kanban__actions">
        <Link
          to={`/proposals/${encodeURIComponent(card.proposalId)}`}
          className="kanban__button kanban__link"
          aria-label={`Review the proposal of ${task.title}`}
        >
          Review
        </Link>
      </div>
    </article>
  )
}

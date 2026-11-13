import type { ReactNode } from 'react'
import { avatarColour } from '../gantt/avatar.ts'
import './task-editors.css'

/** A person the editors offer: someone with a role in the task's project. */
export interface Person {
  accountId: string
  username: string
}

/** Who the editors can name and offer, and whom they mark (FR-199). */
export interface PeopleOnTask {
  /** The people who can be added: the project's members. */
  choices: readonly Person[]
  /** A person's username, for anyone on the task or among the choices. */
  nameOf: (accountId: string) => string
  /** The people on the task who cannot read its project (FR-199). */
  cannotRead: ReadonlySet<string>
  /** The task's project's name, for the mark. */
  projectName: string
}

/**
 * A person in an editor, by username, with a mark if they cannot read the task's project (FR-199),
 * a remove button, and what else the editor puts beside them.
 */
export function PersonChip({
  accountId,
  people,
  onRemove,
  children,
}: {
  accountId: string
  people: PeopleOnTask
  onRemove: () => void
  children?: ReactNode
}) {
  const name = people.nameOf(accountId)
  const marked = people.cannotRead.has(accountId)
  return (
    <li
      aria-label={name}
      data-cannot-read={marked}
      className={'task-editor__person' + (marked ? ' task-editor__person--marked' : '')}
    >
      <span
        className="task-editor__avatar"
        style={{ background: avatarColour(accountId) }}
        aria-hidden="true"
      >
        {name.slice(0, 2).toUpperCase()}
      </span>
      <span className="task-editor__name">{name}</span>
      {marked ? (
        <span
          className="task-editor__mark"
          title={`${name} lost access to ${people.projectName} after being added`}
        >
          Cannot read {people.projectName}
        </span>
      ) : null}
      {children}
      <button
        type="button"
        className="task-editor__remove"
        aria-label={`Remove ${name}`}
        onClick={onRemove}
      >
        ×
      </button>
    </li>
  )
}

/**
 * A list of people to add from, `choices` less those in `taken`; picking one calls `onAdd`. Gives
 * nothing when no one is left to add.
 */
export function AddPerson({
  label,
  choices,
  taken,
  onAdd,
}: {
  label: string
  choices: readonly Person[]
  taken: readonly string[]
  onAdd: (accountId: string) => void
}) {
  const left = choices.filter((person) => !taken.includes(person.accountId))
  if (left.length === 0) return null
  return (
    <select
      aria-label={label}
      className="task-editor__add"
      value=""
      onChange={(event) => {
        if (event.target.value) onAdd(event.target.value)
      }}
    >
      <option value="">Add a person…</option>
      {left.map((person) => (
        <option key={person.accountId} value={person.accountId}>
          {person.username}
        </option>
      ))}
    </select>
  )
}

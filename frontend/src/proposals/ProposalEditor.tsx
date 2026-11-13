import { useEffect, useRef, useState } from 'react'
import {
  type ChangeDraft,
  type ChangeNames,
  describeChange,
  DraftError,
  type GroupDraft,
  groupDraft,
  groupPayload,
  STATUS_WORDS,
} from './changes.ts'
import type { ApiGroup } from './proposal.ts'

/**
 * The proposal editor (SC-071): a proposal's groups of changes, each of which a reviewer edits or
 * drops as a whole (FR-074, DD-023). Editing a group types its changes' values anew, or leaves a
 * change out, and saves the group's whole new list of changes; nothing reaches the plan until the
 * proposal is approved. Whether the reviewer may is the REST API's to say, by their role; the
 * editor shows its refusal.
 */
export function ProposalEditor({
  groups,
  names,
  canAct,
  busy,
  editing,
  error,
  onEdit,
  onCancel,
  onSave,
  onDrop,
}: {
  groups: readonly ApiGroup[]
  names: ChangeNames
  /** Whether the proposal still waits for review, so that its groups can be edited or dropped. */
  canAct: boolean
  busy: boolean
  /** The group being edited, if any. */
  editing: string | null
  /** Why the last save or drop was refused, if it was. */
  error: string | null
  onEdit: (groupId: string) => void
  onCancel: () => void
  onSave: (groupId: string, changes: Record<string, unknown>[]) => void
  onDrop: (groupId: string) => void
}) {
  return (
    <section className="proposal-edit__section" aria-labelledby="proposal-groups">
      <h2 className="proposal__heading" id="proposal-groups">
        Changes
      </h2>
      <p className="page__note">Each group of changes is kept, edited or dropped as a whole.</p>
      <ol className="proposal-edit__groups">
        {groups.map((group, index) =>
          editing === group.id ? (
            <GroupForm
              key={group.id}
              group={group}
              number={index + 1}
              groups={groups}
              names={names}
              busy={busy}
              error={error}
              onCancel={onCancel}
              onSave={(changes) => onSave(group.id, changes)}
            />
          ) : (
            <li key={group.id} className="proposal-edit__group" aria-label={`Group ${index + 1}`}>
              <div className="proposal-edit__group-head">
                <h3 className="proposal-edit__group-title">Group {index + 1}</h3>
                {canAct && (
                  <div className="proposal-edit__actions">
                    <button
                      type="button"
                      className="task-editor__button"
                      disabled={busy || editing !== null}
                      onClick={() => onEdit(group.id)}
                    >
                      Edit group
                    </button>
                    <button
                      type="button"
                      className="task-editor__button task-editor__button--quiet"
                      disabled={busy || editing !== null}
                      onClick={() => onDrop(group.id)}
                    >
                      Drop group
                    </button>
                  </div>
                )}
              </div>
              <ul className="proposal-edit__changes">
                {group.changes.map((change) => (
                  <li key={change.id}>{describeChange(change, names, groups)}</li>
                ))}
              </ul>
            </li>
          ),
        )}
      </ol>
      {editing === null && error !== null && (
        <p role="alert" className="proposal-edit__error">
          {error}
        </p>
      )}
    </section>
  )
}

/** A group being edited: its changes' values, typed anew, saved as one. */
function GroupForm({
  group,
  number,
  groups,
  names,
  busy,
  error,
  onCancel,
  onSave,
}: {
  group: ApiGroup
  number: number
  groups: readonly ApiGroup[]
  names: ChangeNames
  busy: boolean
  error: string | null
  onCancel: () => void
  onSave: (changes: Record<string, unknown>[]) => void
}) {
  const [draft, setDraft] = useState<GroupDraft>(() => groupDraft(group))
  const [invalid, setInvalid] = useState<string | null>(null)
  const form = useRef<HTMLFormElement>(null)
  useEffect(() => {
    form.current?.scrollIntoView?.({ block: 'nearest' })
    form.current?.querySelector<HTMLElement>('input, textarea, select, button')?.focus()
  }, [])

  const update = (index: number, change: ChangeDraft) =>
    setDraft({ ...draft, changes: draft.changes.map((c, i) => (i === index ? change : c)) })
  const label = `Group ${number}`
  const message = invalid ?? error
  return (
    <li className="proposal-edit__group proposal-edit__group--editing" aria-label={label}>
      <form
        ref={form}
        aria-label={`Edit group ${number}`}
        onSubmit={(event) => {
          event.preventDefault()
          try {
            const payload = groupPayload(draft)
            setInvalid(null)
            onSave(payload.changes)
          } catch (failure) {
            if (!(failure instanceof DraftError)) throw failure
            setInvalid(failure.message)
          }
        }}
      >
        <h3 className="proposal-edit__group-title">{label}</h3>
        {draft.changes.map((changeDraft, index) => (
          <ChangeFields
            key={changeDraft.change.id}
            draft={changeDraft}
            title={describeChange(changeDraft.change, names, groups)}
            canRemove={draft.changes.length > 1}
            onChange={(next) => update(index, next)}
            onRemove={() =>
              setDraft({ ...draft, changes: draft.changes.filter((_, i) => i !== index) })
            }
          />
        ))}
        {message !== null && (
          <p role="alert" className="proposal-edit__error">
            {message}
          </p>
        )}
        <div className="proposal-edit__actions">
          <button
            type="submit"
            className="task-editor__button task-editor__button--primary"
            disabled={busy}
          >
            Save group
          </button>
          <button type="button" className="task-editor__button" disabled={busy} onClick={onCancel}>
            Cancel
          </button>
        </div>
      </form>
    </li>
  )
}

/** One change of a group being edited: the values it gives that can be typed. */
function ChangeFields({
  draft,
  title,
  canRemove,
  onChange,
  onRemove,
}: {
  draft: ChangeDraft
  title: string
  canRemove: boolean
  onChange: (draft: ChangeDraft) => void
  onRemove: () => void
}) {
  const nothingTyped = draft.fields.length === 0 && draft.status === undefined
  return (
    <fieldset className="proposal-edit__change">
      <legend className="proposal-edit__change-title">{title}</legend>
      <div className="proposal-edit__fields">
        {draft.fields.map((field, index) => {
          const set = (value: string) =>
            onChange({
              ...draft,
              fields: draft.fields.map((f, i) => (i === index ? { ...f, value } : f)),
            })
          return (
            <label key={field.name} className="task-editor__field">
              {field.label}
              {field.kind === 'long-text' ? (
                <textarea value={field.value} onChange={(event) => set(event.target.value)} />
              ) : (
                <input
                  type={field.kind === 'text' ? 'text' : field.kind}
                  step={field.kind === 'number' ? 'any' : undefined}
                  value={field.value}
                  onChange={(event) => set(event.target.value)}
                />
              )}
            </label>
          )
        })}
        {draft.status !== undefined && (
          <label className="task-editor__field">
            Status
            <select
              value={draft.status}
              onChange={(event) => onChange({ ...draft, status: event.target.value })}
            >
              {Object.entries(STATUS_WORDS).map(([status, words]) => (
                <option key={status} value={status}>
                  {words}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>
      {draft.kept.length > 0 && (
        <p className="task-editor__muted">Kept as proposed: {draft.kept.join(', ')}.</p>
      )}
      {nothingTyped && draft.kept.length === 0 && (
        <p className="task-editor__muted">Nothing to type: it is kept or left out as a whole.</p>
      )}
      <button
        type="button"
        className="task-editor__button task-editor__button--quiet"
        disabled={!canRemove}
        title={canRemove ? undefined : 'A group keeps at least one change; drop the group instead'}
        onClick={onRemove}
      >
        Leave this change out
      </button>
    </fieldset>
  )
}

import { AddPerson, type PeopleOnTask, PersonChip } from './PersonChip.tsx'
import type { AssignmentDraft } from './assignment.ts'

/**
 * The assignment editor (SC-100): who will do a task, as a list of people (FR-029), chosen from the
 * project's members whether or not the eligibility names them, with no warning (FR-030, DD-031).
 * Someone already on the list is not offered again, so no one is chosen twice (FR-200). Each
 * person's load can be overridden, replacing the task's for them alone (FR-033); left empty, the
 * task's applies. Each person who cannot read the task's project is marked (FR-199). It edits a
 * draft; saving it is up to the screen it is on.
 */
export function AssignmentEditor({
  draft,
  taskLoad,
  people,
  onChange,
}: {
  draft: AssignmentDraft
  /** The task's own person load, which applies where no override is typed. */
  taskLoad: number | null
  people: PeopleOnTask
  onChange: (draft: AssignmentDraft) => void
}) {
  return (
    <div className="task-editor" role="group" aria-label="Assigned people">
      {draft.assignees.length === 0 ? (
        <p className="task-editor__empty">No one is assigned.</p>
      ) : (
        <ul className="task-editor__items" aria-label="Assigned">
          {draft.assignees.map((accountId) => {
            const name = people.nameOf(accountId)
            return (
              <PersonChip
                key={accountId}
                accountId={accountId}
                people={people}
                onRemove={() => {
                  const overrides = { ...draft.overrides }
                  delete overrides[accountId]
                  onChange({
                    assignees: draft.assignees.filter((id) => id !== accountId),
                    overrides,
                  })
                }}
              >
                <label className="task-editor__load">
                  <span className="task-editor__hidden">Load of {name} in percent</span>
                  <input
                    type="number"
                    min="0"
                    step="any"
                    inputMode="decimal"
                    placeholder={taskLoad === null ? '' : String(taskLoad)}
                    value={draft.overrides[accountId] ?? ''}
                    onChange={(event) =>
                      onChange({
                        ...draft,
                        overrides: { ...draft.overrides, [accountId]: event.target.value },
                      })
                    }
                  />
                  <span aria-hidden="true">%</span>
                </label>
              </PersonChip>
            )
          })}
        </ul>
      )}
      <div className="task-editor__row">
        <AddPerson
          label="Assign a person"
          choices={people.choices}
          taken={draft.assignees}
          onAdd={(accountId) =>
            onChange({
              assignees: [...draft.assignees, accountId],
              overrides: { ...draft.overrides, [accountId]: '' },
            })
          }
        />
      </div>
      {draft.assignees.length > 0 && taskLoad !== null ? (
        <p className="task-editor__muted">A load left empty is the task&apos;s own, {taskLoad}%.</p>
      ) : null}
    </div>
  )
}

/**
 * The person-load field of an AI-only task, whose load can be any percentage of zero or more
 * (FR-149). Where a task becomes AI-only, the screen fills it with 1% (`AI_ONLY_DEFAULT_LOAD`).
 */
export function PersonLoadField({
  value,
  onChange,
  className,
}: {
  value: string
  onChange: (value: string) => void
  className?: string
}) {
  return (
    <label className={className ?? 'task-editor__field'}>
      Person load in percent
      <input
        type="number"
        min="0"
        step="any"
        inputMode="decimal"
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
    </label>
  )
}

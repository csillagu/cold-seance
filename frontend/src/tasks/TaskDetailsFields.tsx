import { PersonLoadField } from './AssignmentEditor.tsx'
import {
  type DetailsDraft,
  draftIsAiOnly,
  numberOf,
  type Repository,
  repositoryName,
} from './task-details.ts'
import './task-editors.css'
import './task-details.css'

/**
 * The fields of the task details editor (SC-098): title, description, planned dates or none, the
 * duration in whole working days (DD-006), effort and AI share. A milestone (`milestone`) has its
 * title and description here only. `offerPersonLoad` shows the person-load field, at 1% unless
 * changed (FR-149), once the AI share is set to 100%.
 */
export function TaskDetailsFields({
  draft,
  onChange,
  milestone = false,
  offerPersonLoad,
}: {
  draft: DetailsDraft
  onChange: (draft: DetailsDraft) => void
  milestone?: boolean
  offerPersonLoad: boolean
}) {
  const set = (field: keyof DetailsDraft) => (value: string) =>
    onChange({ ...draft, [field]: value })
  const noDates = draft.start === '' && draft.duration === '' && draft.finish === ''

  return (
    <div className="task-editor task-details">
      <label className="task-editor__field task-details__wide">
        Title
        <input value={draft.title} onChange={(event) => set('title')(event.target.value)} />
      </label>
      <label className="task-editor__field task-details__wide">
        Description
        <textarea
          rows={3}
          value={draft.description}
          onChange={(event) => set('description')(event.target.value)}
        />
      </label>
      {milestone ? null : (
        <>
          <fieldset className="task-details__dates">
            <legend className="task-details__legend">Planned dates</legend>
            <div className="task-editor__row task-details__row">
              <label className="task-editor__field">
                Planned start
                <input
                  type="date"
                  value={draft.start}
                  onChange={(event) => set('start')(event.target.value)}
                />
              </label>
              <label className="task-editor__field">
                Duration in working days
                <input
                  type="number"
                  min="1"
                  step="1"
                  inputMode="numeric"
                  value={draft.duration}
                  onChange={(event) => set('duration')(event.target.value)}
                />
              </label>
              {numberOf(draft.duration) === null ? (
                <label className="task-editor__field">
                  Planned finish
                  <input
                    type="date"
                    value={draft.finish}
                    onChange={(event) => set('finish')(event.target.value)}
                  />
                </label>
              ) : null}
            </div>
            <div className="task-editor__row">
              {noDates ? (
                <p className="task-editor__muted">No planned dates: the task is unscheduled.</p>
              ) : (
                <button
                  type="button"
                  className="task-editor__button task-editor__button--quiet"
                  onClick={() => onChange({ ...draft, start: '', duration: '', finish: '' })}
                >
                  Clear the planned dates
                </button>
              )}
            </div>
          </fieldset>
          <div className="task-editor__row task-details__row">
            <label className="task-editor__field">
              Effort
              <input
                type="number"
                min="0"
                step="any"
                inputMode="decimal"
                value={draft.effort}
                onChange={(event) => set('effort')(event.target.value)}
              />
            </label>
            <label className="task-editor__field">
              AI share in percent
              <input
                type="number"
                min="0"
                max="100"
                step="any"
                inputMode="decimal"
                value={draft.aiShare}
                onChange={(event) => set('aiShare')(event.target.value)}
              />
            </label>
            {offerPersonLoad && draftIsAiOnly(draft) ? (
              <PersonLoadField value={draft.personLoad} onChange={set('personLoad')} />
            ) : null}
          </div>
        </>
      )}
    </div>
  )
}

/**
 * The choice of a repository for a task: none, or one its project pulls issues from (FR-141).
 * A `value` the project no longer pulls from (its approval was withdrawn) is still listed, so that
 * the choice shows what the task is assigned to.
 */
export function RepositoryField({
  value,
  repositories,
  allowNone,
  onChange,
}: {
  value: string
  repositories: readonly Repository[]
  allowNone: boolean
  onChange: (repositoryId: string) => void
}) {
  const known = value === '' || repositories.some((repository) => repository.id === value)
  return (
    <label className="task-editor__field task-details__select">
      Repository
      <select value={value} onChange={(event) => onChange(event.target.value)}>
        {allowNone ? <option value="">None</option> : null}
        {known ? null : (
          <option value={value}>A repository the project no longer pulls from</option>
        )}
        {repositories.map((repository) => (
          <option key={repository.id} value={repository.id}>
            {repositoryName(repository)}
          </option>
        ))}
      </select>
    </label>
  )
}

import { type ChangeNames, conflictWords, describeChange } from './changes.ts'
import type { ApiConflict, ApiGroup } from './proposal.ts'

/**
 * The proposal conflict panel (SC-070): each change of the proposal whose input on the same task
 * someone else edited after it was proposed, or whose task was deleted (FR-076, DD-022), for the
 * reviewer to resolve or drop. A change is resolved by editing its group, which gives its changes
 * anew, and dropped with its group, as a group is kept, edited or dropped as one (DD-023). Which
 * changes conflict is the REST API's to say (SC-047); the panel only shows them.
 */
export function ConflictPanel({
  conflicts,
  groups,
  names,
  canAct,
  busy,
  onResolve,
  onDrop,
}: {
  conflicts: readonly ApiConflict[]
  groups: readonly ApiGroup[]
  names: ChangeNames
  /** Whether the proposal still waits for review, so that a conflict can be resolved or dropped. */
  canAct: boolean
  busy: boolean
  onResolve: (groupId: string) => void
  onDrop: (groupId: string) => void
}) {
  const groupNumber = new Map(groups.map((group, index) => [group.id, index + 1]))
  return (
    <section className="proposal-edit__section" aria-labelledby="proposal-conflicts">
      <h2 className="proposal__heading" id="proposal-conflicts">
        Conflicts
      </h2>
      {conflicts.length === 0 ? (
        <p className="page__note">
          None: no one else has changed what the proposal changes since it was proposed.
        </p>
      ) : (
        <ul className="proposal-edit__conflicts" aria-labelledby="proposal-conflicts">
          {conflicts.map((conflict) => {
            const group = groups.find((candidate) => candidate.id === conflict.groupId)
            const change = group?.changes.find((candidate) => candidate.id === conflict.changeId)
            const what = change ? describeChange(change, names, groups) : 'A change'
            const number = groupNumber.get(conflict.groupId)
            return (
              <li key={conflict.changeId} className="proposal-edit__conflict" aria-label={what}>
                <div className="proposal-edit__conflict-text">
                  <span className="proposal-edit__conflict-change">{what}</span>
                  <span className="proposal-edit__conflict-why">
                    {conflictWords(conflict, names)}
                  </span>
                  {number !== undefined && (
                    <span className="proposal-edit__conflict-group">In group {number}</span>
                  )}
                </div>
                {canAct && (
                  <div className="proposal-edit__actions">
                    <button
                      type="button"
                      className="task-editor__button"
                      disabled={busy}
                      onClick={() => onResolve(conflict.groupId)}
                    >
                      Resolve
                    </button>
                    <button
                      type="button"
                      className="task-editor__button task-editor__button--quiet"
                      disabled={busy}
                      onClick={() => onDrop(conflict.groupId)}
                    >
                      Drop
                    </button>
                  </div>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}

import { AddPerson, type PeopleOnTask, PersonChip } from './PersonChip.tsx'
import {
  describeExpression,
  type EligibilityDraft,
  expressionOf,
  type Group,
  type Operator,
} from './eligibility.ts'

/**
 * The eligibility expression editor (SC-099): who can do a task, built as an AND or OR of people
 * and of groups of people, each group itself an AND or OR of people (FR-028). A group cannot hold a
 * group, so nothing deeper than two levels can be built (FR-197). Each person who cannot read the
 * task's project is marked (FR-199). It edits a draft; saving it is up to the screen it is on.
 */
export function EligibilityEditor({
  draft,
  people,
  onChange,
}: {
  draft: EligibilityDraft
  people: PeopleOnTask
  onChange: (draft: EligibilityDraft) => void
}) {
  const topPeople = draft.items.filter((item) => typeof item === 'string')
  const setItems = (items: EligibilityDraft['items']) => onChange({ ...draft, items })
  const setGroup = (index: number, group: Group | null) =>
    setItems(
      group === null
        ? draft.items.filter((_, at) => at !== index)
        : draft.items.map((item, at) => (at === index ? group : item)),
    )
  let groups = 0

  return (
    <div className="task-editor" role="group" aria-label="Eligibility">
      <div className="task-editor__row">
        <OperatorSelect
          label="Top level"
          operator={draft.operator}
          onChange={(operator) => onChange({ ...draft, operator })}
        />
      </div>
      {draft.items.length === 0 ? (
        <p className="task-editor__empty">No one yet.</p>
      ) : (
        <ul className="task-editor__items" aria-label="Top level operands">
          {draft.items.map((item, index) => {
            if (typeof item === 'string') {
              return (
                <PersonChip
                  key={`person-${item}`}
                  accountId={item}
                  people={people}
                  onRemove={() => setItems(draft.items.filter((_, at) => at !== index))}
                />
              )
            }
            groups += 1
            return (
              <GroupEditor
                key={`group-${index}`}
                number={groups}
                group={item}
                people={people}
                onChange={(group) => setGroup(index, group)}
              />
            )
          })}
        </ul>
      )}
      <div className="task-editor__row">
        <AddPerson
          label="Add a person to the top level"
          choices={people.choices}
          taken={topPeople}
          onAdd={(accountId) => setItems([...draft.items, accountId])}
        />
        <button
          type="button"
          className="task-editor__button"
          onClick={() => setItems([...draft.items, { operator: 'any', people: [] }])}
        >
          Add a group
        </button>
      </div>
      <p className="task-editor__expression">
        <span className="task-editor__muted">Expression: </span>
        <output aria-label="Expression">
          {describeExpression(expressionOf(draft), people.nameOf)}
        </output>
      </p>
    </div>
  )
}

/** A group of the second level: an AND or OR of people, and no group (FR-197). */
function GroupEditor({
  number,
  group,
  people,
  onChange,
}: {
  number: number
  group: Group
  people: PeopleOnTask
  onChange: (group: Group | null) => void
}) {
  const name = `Group ${number}`
  return (
    <li className="task-editor__group" aria-label={name}>
      <div className="task-editor__row">
        <OperatorSelect
          label={name}
          operator={group.operator}
          onChange={(operator) => onChange({ ...group, operator })}
        />
        <button
          type="button"
          className="task-editor__button task-editor__button--quiet"
          onClick={() => onChange(null)}
        >
          Remove {name.toLowerCase()}
        </button>
      </div>
      {group.people.length === 0 ? (
        <p className="task-editor__empty">Add at least one person.</p>
      ) : (
        <ul className="task-editor__items" aria-label={`${name} operands`}>
          {group.people.map((accountId) => (
            <PersonChip
              key={accountId}
              accountId={accountId}
              people={people}
              onRemove={() =>
                onChange({ ...group, people: group.people.filter((id) => id !== accountId) })
              }
            />
          ))}
        </ul>
      )}
      <AddPerson
        label={`Add a person to ${name.toLowerCase()}`}
        choices={people.choices}
        taken={group.people}
        onAdd={(accountId) => onChange({ ...group, people: [...group.people, accountId] })}
      />
    </li>
  )
}

function OperatorSelect({
  label,
  operator,
  onChange,
}: {
  label: string
  operator: Operator
  onChange: (operator: Operator) => void
}) {
  return (
    <select
      aria-label={label}
      className="task-editor__operator"
      value={operator}
      onChange={(event) => onChange(event.target.value === 'all' ? 'all' : 'any')}
    >
      <option value="all">All of (AND)</option>
      <option value="any">Any of (OR)</option>
    </select>
  )
}

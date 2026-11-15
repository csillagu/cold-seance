import {
  comparisonsOf,
  type DraftCondition,
  FIELDS,
  type FilterField,
  kindOf,
  MILESTONE_VARIANTS,
  needsValue,
  newCondition,
  STATUSES,
  VIEWER,
  withField,
} from './filter.ts'

/** Something a condition's value can be chosen from: a person, a project or a repository. */
export interface Choice {
  id: string
  name: string
}

interface FilterBuilderProps {
  conditions: readonly DraftCondition[]
  onChange: (conditions: DraftCondition[]) => void
  /** The people a people condition can name, besides the person viewing. */
  people: readonly Choice[]
  /** The projects a project condition can name: those the view covers. */
  projects: readonly Choice[]
  /** The repositories a repository condition can name. */
  repositories: readonly Choice[]
}

/**
 * The saved view filter builder (SC-092): the part of the saved view editor in which a view's
 * filter is built, as conditions a task must all meet, each on one task field (FR-057). A
 * condition on the eligibility or the assigned people can name the person viewing the view
 * (FR-058), wherever the view is kept, so that one view shows each viewer their own tasks.
 */
export function FilterBuilder({
  conditions,
  onChange,
  people,
  projects,
  repositories,
}: FilterBuilderProps) {
  const change = (index: number, condition: DraftCondition) =>
    onChange(conditions.map((old, at) => (at === index ? condition : old)))
  const remove = (index: number) => onChange(conditions.filter((_, at) => at !== index))

  return (
    <fieldset className="views__filter">
      <legend className="views__legend">Filter</legend>
      {conditions.length === 0 ? (
        <p className="views__hint">No conditions: the view shows every task it covers.</p>
      ) : (
        <p className="views__hint">The view shows the tasks that meet every condition.</p>
      )}
      <ol className="views__conditions">
        {conditions.map((condition, index) => (
          <ConditionRow
            // The conditions have no ids of their own; a row is its place in the list.
            key={index}
            position={index + 1}
            condition={condition}
            people={people}
            projects={projects}
            repositories={repositories}
            onChange={(changed) => change(index, changed)}
            onRemove={() => remove(index)}
          />
        ))}
      </ol>
      <button
        type="button"
        className="account__button account__button--quiet"
        onClick={() => onChange([...conditions, newCondition()])}
      >
        Add condition
      </button>
    </fieldset>
  )
}

interface ConditionRowProps {
  position: number
  condition: DraftCondition
  people: readonly Choice[]
  projects: readonly Choice[]
  repositories: readonly Choice[]
  onChange: (condition: DraftCondition) => void
  onRemove: () => void
}

function ConditionRow({
  position,
  condition,
  people,
  projects,
  repositories,
  onChange,
  onRemove,
}: ConditionRowProps) {
  const name = `Condition ${position}`
  const id = `condition-${position}`
  return (
    <li className="views__condition" role="group" aria-label={name}>
      <label className="views__condition-part">
        <span>Field</span>
        <select
          value={condition.field}
          onChange={(event) => {
            const field = FIELDS.find((known) => known.field === event.target.value)?.field
            if (field !== undefined) onChange(withField(condition, field))
          }}
        >
          {FIELDS.map((field) => (
            <option key={field.field} value={field.field}>
              {field.label}
            </option>
          ))}
        </select>
      </label>
      <label className="views__condition-part">
        <span>Comparison</span>
        <select
          value={condition.comparison}
          onChange={(event) => {
            const comparison = comparisonsOf(condition.field).find(
              (known) => known.value === event.target.value,
            )?.value
            if (comparison !== undefined) onChange({ ...condition, comparison })
          }}
        >
          {comparisonsOf(condition.field).map((comparison) => (
            <option key={comparison.value} value={comparison.value}>
              {comparison.label}
            </option>
          ))}
        </select>
      </label>
      {needsValue(condition.comparison) && (
        <label className="views__condition-part">
          <span>Value</span>
          <ValueInput
            id={`${id}-value`}
            field={condition.field}
            value={condition.value}
            people={people}
            projects={projects}
            repositories={repositories}
            onChange={(value) => onChange({ ...condition, value })}
          />
        </label>
      )}
      <button
        type="button"
        className="account__button account__button--quiet views__remove"
        aria-label={`Remove condition ${position}`}
        onClick={onRemove}
      >
        Remove
      </button>
    </li>
  )
}

interface ValueInputProps {
  id: string
  field: FilterField
  value: string
  people: readonly Choice[]
  projects: readonly Choice[]
  repositories: readonly Choice[]
  onChange: (value: string) => void
}

/** The input a condition's value is given in, as the kind of its field asks. */
function ValueInput({
  id,
  field,
  value,
  people,
  projects,
  repositories,
  onChange,
}: ValueInputProps) {
  const choose = (options: readonly { value: string; label: string }[], prompt?: string) => (
    <select id={id} value={value} onChange={(event) => onChange(event.target.value)}>
      {prompt !== undefined && <option value="">{prompt}</option>}
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  )
  const named = (choices: readonly Choice[]) =>
    choices.map((choice) => ({ value: choice.id, label: choice.name }))

  switch (kindOf(field)) {
    case 'status':
      return choose(STATUSES)
    case 'milestone':
      return choose(MILESTONE_VARIANTS)
    case 'people':
      return choose([{ value: VIEWER, label: 'The person viewing' }, ...named(people)])
    case 'project':
      return choose(named(projects), 'Choose a project')
    case 'repository':
      return choose(named(repositories), 'Choose a repository')
    case 'date':
      return (
        <input
          id={id}
          type="date"
          value={value}
          onChange={(event) => onChange(event.target.value)}
        />
      )
    case 'number':
    case 'issue':
      return (
        <input
          id={id}
          type="number"
          step={field === 'githubIssue' || field === 'durationWorkingDays' ? 1 : 'any'}
          min={field === 'githubIssue' ? 1 : undefined}
          value={value}
          onChange={(event) => onChange(event.target.value)}
        />
      )
    default:
      // Text.
      return (
        <input
          id={id}
          type="text"
          autoComplete="off"
          value={value}
          onChange={(event) => onChange(event.target.value)}
        />
      )
  }
}

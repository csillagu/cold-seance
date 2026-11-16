import { useState } from 'react'
import { avatarColour } from '../gantt/avatar.ts'
import { formatDay, weekday } from '../gantt/gantt-model.ts'
import { TaskTitleButton } from '../tasks/TaskTitleButton.tsx'
import {
  type ApiDayLoad,
  cellLabel,
  formatPercent,
  type LoadRow,
  NO_LOAD_WORDS,
  type NoLoadTask,
} from './load-model.ts'
import './load.css'

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

interface PersonLoadProps {
  /** What it is a person load view of, for its accessible name. */
  name: string
  /** The project the view is of: its own tasks are not named by project. */
  projectId: string
  /** The days the view covers, in order. */
  days: readonly string[]
  rows: readonly LoadRow[]
  /** The names of the projects the viewer can read, by id, to name another project's task. */
  projectNames: ReadonlyMap<string, string>
  /** The tasks of the project that put load on no one. */
  noLoad: readonly NoLoadTask[]
  /** The usernames of the project's members, by account id. */
  people: ReadonlyMap<string, string>
  /** Opens the task dialog of the task `taskId`: its title was clicked (#209). */
  onOpen: (taskId: string) => void
}

/** The day of one person that is selected, to show what is behind its load. */
interface Selected {
  row: LoadRow
  day: ApiDayLoad
}

/**
 * The person load chart (SC-032): one row per person, one column per day, each cell the person's
 * whole load that day across all projects against their capacity (FR-051), red on each day the
 * load is above the capacity (FR-042). A day's cell, selected, shows what is behind its load: the
 * tasks of the projects the viewer can read, by name, and the rest only as a percentage for other
 * projects (FR-046, DD-014). Each row names the readable tasks that load the person in the span.
 * Below, the project's tasks that put load on no one, unscheduled ones among them (FR-004), so
 * that every task of the project is in the view. Each task's title opens the task dialog (#209).
 */
export function PersonLoad({
  name,
  projectId,
  days,
  rows,
  projectNames,
  noLoad,
  people,
  onOpen,
}: PersonLoadProps) {
  const [selected, setSelected] = useState<Selected | null>(null)
  const isSelected = (row: LoadRow, day: ApiDayLoad) =>
    selected?.row.accountId === row.accountId && selected.day.date === day.date
  const projectOf = (id: string) =>
    id === projectId ? null : (projectNames.get(id) ?? 'Another project')

  return (
    <div className="load">
      {rows.length === 0 ? (
        <p className="page__note">The project has no members, so there is no one to show.</p>
      ) : (
        <div className="load__scroll">
          <table className="load__table" aria-label={name}>
            <thead>
              <tr>
                <th scope="col" className="load__corner">
                  Person
                </th>
                {days.map((day) => (
                  <th key={day} scope="col" className="load__day">
                    <span className="load__weekday">{WEEKDAYS[weekday(day)]}</span>
                    <span>{formatDay(day)}</span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.accountId}>
                  <th scope="row" className="load__person">
                    <span className="load__name">
                      <span
                        className="load__avatar"
                        style={{ background: avatarColour(row.accountId) }}
                        aria-hidden="true"
                      >
                        {row.username.slice(0, 1).toUpperCase()}
                      </span>
                      {row.username}
                    </span>
                    {row.tasks.length > 0 && (
                      <ul className="load__tasks" aria-label={`Tasks of ${row.username}`}>
                        {row.tasks.map((task) => (
                          <li key={task.taskId}>
                            <TaskTitleButton
                              title={task.title}
                              onOpen={() => onOpen(task.taskId)}
                            />{' '}
                            <span className="load__faint">
                              {formatPercent(task.load)}
                              {projectOf(task.projectId) && ` · ${projectOf(task.projectId)}`}
                            </span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </th>
                  {row.days.map((day) => (
                    <td key={day.date} className="load__cell-holder">
                      <button
                        type="button"
                        className={cellClass(day, isSelected(row, day))}
                        aria-label={cellLabel(row.username, day)}
                        aria-pressed={isSelected(row, day)}
                        onClick={() => setSelected(isSelected(row, day) ? null : { row, day })}
                      >
                        <span className="load__value">{formatPercent(day.load)}</span>
                        {day.capacity !== null && (
                          <span className="load__capacity">of {day.capacity}%</span>
                        )}
                      </button>
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {selected && (
        <DayDetails
          username={selected.row.username}
          day={selected.day}
          projectOf={projectOf}
          onClose={() => setSelected(null)}
          onOpen={onOpen}
        />
      )}

      {noLoad.length > 0 && (
        <section className="load__panel" aria-label="Tasks on no one's load">
          <h2 className="load__panel-title">Tasks on no one&apos;s load</h2>
          <ul className="load__list">
            {noLoad.map(({ task, reason }) => (
              <li key={task.id} className="load__item">
                <article aria-label={task.title} className="load__item-body">
                  <TaskTitleButton
                    title={task.title}
                    className="load__item-title"
                    onOpen={() => onOpen(task.id)}
                  />
                  <span className="load__faint">{NO_LOAD_WORDS[reason]}</span>
                  <span className="load__faint">
                    {task.assignees.length === 0
                      ? 'No one assigned'
                      : `Assigned to ${task.assignees.map((id) => people.get(id) ?? 'Unknown person').join(', ')}`}
                  </span>
                </article>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}

/** The class of a day's cell: red when the person is overloaded that day (FR-042). */
function cellClass(day: ApiDayLoad, selected: boolean): string {
  let name = 'load__cell'
  if (day.overloaded === true) name += ' load__cell--over'
  else if (day.load === 0) name += ' load__cell--idle'
  if (selected) name += ' load__cell--selected'
  return name
}

interface DayDetailsProps {
  username: string
  day: ApiDayLoad
  /** The name of a task's project, or null for the view's own project. */
  projectOf: (projectId: string) => string | null
  onClose: () => void
  onOpen: (taskId: string) => void
}

/**
 * What is behind one person's load on one day: the tasks of the projects the viewer can read, by
 * name and load, and the load from the other projects only as a percentage (FR-046, DD-014).
 */
function DayDetails({ username, day, projectOf, onClose, onOpen }: DayDetailsProps) {
  const title = `Load of ${username} on ${formatDay(day.date, true)}`
  return (
    <section className="load__panel load__details" aria-label={title}>
      <div className="load__details-head">
        <h2 className="load__panel-title">{title}</h2>
        <button type="button" className="load__close" onClick={onClose}>
          Close
        </button>
      </div>
      <p className={day.overloaded === true ? 'load__total load__total--over' : 'load__total'}>
        Total {formatPercent(day.load)}
        {day.capacity !== null && ` of ${day.capacity}% capacity`}
        {day.overloaded === true && ' · Overloaded'}
      </p>
      {day.tasks.length === 0 && day.otherProjects === 0 ? (
        <p className="load__faint">No task loads {username} this day.</p>
      ) : (
        <ul className="load__list">
          {day.tasks.map((task) => (
            <li key={task.taskId} className="load__item">
              <TaskTitleButton
                title={task.title}
                className="load__item-title"
                onOpen={() => onOpen(task.taskId)}
              />
              {projectOf(task.projectId) && (
                <span className="load__faint">{projectOf(task.projectId)}</span>
              )}
              <span className="load__item-load">{formatPercent(task.load)}</span>
            </li>
          ))}
          {day.otherProjects > 0 && (
            <li className="load__item">
              <span className="load__item-title">
                Other projects: {formatPercent(day.otherProjects)}
              </span>
            </li>
          )}
        </ul>
      )}
    </section>
  )
}

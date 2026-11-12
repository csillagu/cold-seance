import type { CSSProperties } from 'react'
import {
  arrowPath,
  daysBetween,
  formatDay,
  formatMonth,
  type GanttDependency,
  type GanttModel,
  type GanttRow,
} from './gantt-model.ts'
import './gantt.css'

/** The width of a day on the timeline, and the height of a row, in pixels, as the design draws them. */
const DAY_WIDTH = 44
const ROW_HEIGHT = 40

/** Where a bar sits within its row, and how tall it is. */
const BAR_TOP = 8
const BAR_HEIGHT = 18
/** The half width of a milestone's diamond, from its centre to its tip. */
const DIAMOND = 11

/** A person as the Gantt names them: by their username, from the project's members. */
export type PeopleById = ReadonlyMap<string, string>

interface GanttProps {
  /** What it is a Gantt of, for its accessible name. */
  name: string
  model: GanttModel
  people: PeopleById
  /** Today, `YYYY-MM-DD`: marked on the timeline if it lies within it. */
  today: string
}

/**
 * The Gantt timeline (SC-031, DD-042): the tasks as bars on their dates, the dependencies between
 * them as arrows, the milestones as diamonds, and constraint violations and tasks whose assigned
 * people cannot do them in red (FR-049, FR-013, FR-020), as the approved design draws it (SRC-249).
 * A table of the tasks on the left, the timeline on the right; the panel scrolls sideways, with the
 * table kept in view.
 */
export function Gantt({ name, model, people, today }: GanttProps) {
  const { rows, days, dependencies } = model
  const first = days[0]?.date
  if (!first) {
    return <p className="page__note">No task of this project has planned dates yet.</p>
  }
  const timelineWidth = days.length * DAY_WIDTH
  const todayIndex = daysBetween(first, today)
  const showToday = todayIndex >= 0 && todayIndex < days.length

  return (
    <div className="gantt">
      <div className="gantt__scroll">
        <div role="table" aria-label={name} className="gantt__table">
          <div role="rowgroup" className="gantt__head">
            <div role="row" className="gantt__row gantt__row--head">
              <div className="gantt__left gantt__left--head">
                <span role="columnheader">Task</span>
                <span role="columnheader">Assigned</span>
                <span role="columnheader">Start</span>
                <span role="columnheader" className="gantt__num">
                  Days
                </span>
              </div>
              <div className="gantt__timeline-head" style={{ width: timelineWidth }}>
                <div className="gantt__months" aria-hidden="true">
                  {months(days.map((day) => day.date)).map((month) => (
                    <span
                      key={month.date}
                      className="gantt__month"
                      style={{ left: month.index * DAY_WIDTH, width: month.length * DAY_WIDTH }}
                    >
                      {formatMonth(month.date)}
                    </span>
                  ))}
                </div>
                <div className="gantt__days">
                  {days.map((day) => (
                    <span
                      key={day.date}
                      role="columnheader"
                      aria-label={formatDay(day.date, true)}
                      data-date={day.date}
                      className={
                        'gantt__day' +
                        (day.nonWorking ? ' gantt__day--off' : '') +
                        (day.date === today ? ' gantt__day--today' : '')
                      }
                    >
                      <span className="gantt__weekday">{WEEKDAY_LETTERS[weekdayOf(day.date)]}</span>
                      <span className="gantt__date">{Number(day.date.slice(8))}</span>
                    </span>
                  ))}
                </div>
                {showToday && (
                  <span className="gantt__today-tag" style={{ left: todayIndex * DAY_WIDTH }}>
                    Today {formatDay(today)}
                  </span>
                )}
              </div>
            </div>
          </div>
          <div role="rowgroup" className="gantt__body">
            {rows.map((row) => (
              <TaskRow key={row.task.id} row={row} first={first} people={people} />
            ))}
            <div
              className="gantt__overlay"
              aria-hidden="true"
              style={{ width: timelineWidth, height: rows.length * ROW_HEIGHT }}
            >
              {days.map(
                (day, index) =>
                  day.nonWorking && (
                    <span
                      key={day.date}
                      className="gantt__off"
                      style={{ left: index * DAY_WIDTH, width: DAY_WIDTH }}
                    />
                  ),
              )}
              {showToday && (
                <span
                  className="gantt__today-line"
                  style={{ left: todayIndex * DAY_WIDTH + DAY_WIDTH / 2 - 1 }}
                />
              )}
            </div>
            <Dependencies
              rows={rows}
              dependencies={dependencies}
              first={first}
              width={timelineWidth}
            />
          </div>
        </div>
      </div>
      <Legend />
    </div>
  )
}

const WEEKDAY_LETTERS = ['M', 'T', 'W', 'T', 'F', 'S', 'S']

function weekdayOf(date: string): number {
  return (new Date(`${date}T00:00:00Z`).getUTCDay() + 6) % 7
}

/** The months the days fall in, each with the index of its first day and how many days it has. */
function months(dates: readonly string[]): { date: string; index: number; length: number }[] {
  const result: { date: string; index: number; length: number }[] = []
  dates.forEach((date, index) => {
    const last = result.at(-1)
    if (last && last.date.slice(0, 7) === date.slice(0, 7)) last.length += 1
    else result.push({ date, index, length: 1 })
  })
  return result
}

const STATUS_WORDS: Record<GanttRow['task']['status'], string> = {
  'not-started': 'not started',
  'in-progress': 'in progress',
  'on-hold': 'on hold',
  done: 'done',
  cancelled: 'cancelled',
}

/** What a bar says to a screen reader: the task, its dates, and why it is red. */
function barLabel(row: GanttRow): string {
  const { task } = row
  const when = task.milestone
    ? `${task.milestone.variant === 'fixed-date' ? 'fixed-date' : 'floating'} milestone on ${formatDay(row.start, true)}`
    : `${formatDay(row.start, true)} to ${formatDay(row.finish, true)}`
  const red = row.red
    ? task.milestone
      ? ', in red: pushed past its date'
      : ', in red: a constraint is violated or its assigned people cannot do it in its time'
    : ''
  return `${task.title}: ${when}${red}`
}

function TaskRow({ row, first, people }: { row: GanttRow; first: string; people: PeopleById }) {
  const { task } = row
  const start = daysBetween(first, row.start)
  const length = daysBetween(row.start, row.finish) + 1
  const assignees = task.assignees.map((id) => ({ id, name: people.get(id) }))

  return (
    <div
      role="row"
      aria-label={task.title}
      data-task-id={task.id}
      data-red={row.red}
      className={'gantt__row' + (row.red ? ' gantt__row--red' : '')}
    >
      <div className="gantt__left" style={{ paddingLeft: 16 + row.depth * 24 }}>
        <span role="cell" className={'gantt__title' + (row.parent ? ' gantt__title--parent' : '')}>
          {task.milestone ? (
            <span
              className={
                'gantt__diamond-icon' +
                (task.milestone.variant === 'floating' ? ' gantt__diamond-icon--floating' : '')
              }
              aria-hidden="true"
            />
          ) : (
            <span
              className={`gantt__status gantt__status--${task.status}`}
              title={STATUS_WORDS[task.status]}
              aria-hidden="true"
            />
          )}
          <span className="gantt__title-text">{task.title}</span>
          {task.milestone ? (
            <span className="gantt__tag">
              {task.milestone.variant === 'fixed-date' ? 'fixed' : 'floating'}
            </span>
          ) : task.status === 'on-hold' ? (
            <span className="gantt__tag gantt__tag--hold">on hold</span>
          ) : task.aiShare ? (
            <span className="gantt__tag">AI {task.aiShare}%</span>
          ) : null}
        </span>
        <span role="cell" className="gantt__people">
          {assignees.length === 0 ? (
            <span className="gantt__none">—</span>
          ) : (
            assignees.map(({ id, name }) => (
              <span
                key={id}
                className="gantt__avatar"
                title={name ?? 'Someone who is not a member'}
                style={{ background: avatarColour(id) }}
              >
                {name ? name.slice(0, 2).toUpperCase() : '?'}
              </span>
            ))
          )}
        </span>
        <span role="cell" className="gantt__mono">
          {formatDay(row.start)}
        </span>
        <span role="cell" className="gantt__mono gantt__num">
          {task.milestone || task.durationWorkingDays === null ? (
            <span className="gantt__none">—</span>
          ) : (
            task.durationWorkingDays
          )}
        </span>
      </div>
      <div role="cell" className="gantt__lane">
        <Bar row={row} left={start * DAY_WIDTH} width={length * DAY_WIDTH} />
        {row.note && (
          <span
            className="gantt__note"
            style={{
              left: task.milestone
                ? start * DAY_WIDTH + DAY_WIDTH / 2 + DIAMOND + 12
                : (start + length) * DAY_WIDTH + 8,
            }}
          >
            {row.note}
          </span>
        )}
      </div>
    </div>
  )
}

function Bar({ row, left, width }: { row: GanttRow; left: number; width: number }) {
  const { task } = row
  const label = barLabel(row)
  const common = {
    role: 'img',
    'aria-label': label,
    title: label,
    'data-start': row.start,
    'data-finish': row.finish,
  }
  if (task.milestone) {
    const variant = task.milestone.variant === 'floating' ? ' gantt__milestone--floating' : ''
    return (
      <span
        {...common}
        className={'gantt__milestone' + variant + (row.red ? ' gantt__milestone--red' : '')}
        style={{ left: left + DAY_WIDTH / 2 - 8 }}
      />
    )
  }
  if (row.parent) {
    return (
      <span
        {...common}
        className={'gantt__parent' + (row.red ? ' gantt__parent--red' : '')}
        style={{ left: left + 4, width: width - 8 }}
      />
    )
  }
  const style: CSSProperties = { left: left + 4, width: width - 8 }
  return (
    <span
      {...common}
      className={
        'gantt__bar' +
        (task.status === 'on-hold' ? ' gantt__bar--hold' : '') +
        (row.red ? ' gantt__bar--red' : '')
      }
      style={style}
    >
      {!row.red && task.aiShare ? (
        <span className="gantt__ai" style={{ width: `${Math.min(task.aiShare, 100)}%` }} />
      ) : null}
    </span>
  )
}

/** Where a dependency's arrow leaves its blocker and reaches its task, in timeline pixels. */
function ends(row: GanttRow, index: number, first: string) {
  const start = daysBetween(first, row.start)
  const finish = daysBetween(first, row.finish)
  const middle = index * ROW_HEIGHT
  if (row.task.milestone) {
    const centre = start * DAY_WIDTH + DAY_WIDTH / 2
    const y = middle + ROW_HEIGHT / 2
    return { out: { x: centre + DIAMOND, y }, in: { x: centre - DIAMOND, y } }
  }
  const y = middle + BAR_TOP + BAR_HEIGHT / 2
  return {
    out: { x: (finish + 1) * DAY_WIDTH - 4, y },
    in: { x: start * DAY_WIDTH + 4, y },
  }
}

function Dependencies({
  rows,
  dependencies,
  first,
  width,
}: {
  rows: readonly GanttRow[]
  dependencies: readonly GanttDependency[]
  first: string
  width: number
}) {
  const index = new Map(rows.map((row, i) => [row.task.id, i]))
  const height = rows.length * ROW_HEIGHT
  return (
    <svg
      role="group"
      aria-label="Dependencies"
      className="gantt__arrows"
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
    >
      <defs>
        <marker
          id="gantt-arrow"
          viewBox="0 0 8 8"
          refX="7"
          refY="4"
          markerWidth="7"
          markerHeight="7"
          orient="auto"
        >
          <path d="M0 0L8 4L0 8z" className="gantt__arrowhead" />
        </marker>
        <marker
          id="gantt-arrow-red"
          viewBox="0 0 8 8"
          refX="7"
          refY="4"
          markerWidth="7"
          markerHeight="7"
          orient="auto"
        >
          <path d="M0 0L8 4L0 8z" className="gantt__arrowhead gantt__arrowhead--red" />
        </marker>
      </defs>
      {dependencies.map((dependency) => {
        const t = index.get(dependency.task)
        const b = index.get(dependency.blocker)
        if (t === undefined || b === undefined) return null
        const task = rows[t]!
        const blocker = rows[b]!
        const from = ends(blocker, b, first).out
        const to = ends(task, t, first).in
        const gap = (t > b ? t : t + 1) * ROW_HEIGHT
        return (
          <g
            key={`${dependency.task}<${dependency.blocker}`}
            role="img"
            aria-label={
              `${task.task.title} is blocked by ${blocker.task.title}` +
              (dependency.red ? ', in red: it pushes a fixed-date milestone' : '')
            }
            data-red={dependency.red}
          >
            <path
              d={arrowPath(from, to, gap)}
              className={'gantt__arrow' + (dependency.red ? ' gantt__arrow--red' : '')}
              markerEnd={`url(#${dependency.red ? 'gantt-arrow-red' : 'gantt-arrow'})`}
            />
          </g>
        )
      })}
    </svg>
  )
}

function Legend() {
  return (
    <ul className="gantt__legend" aria-label="Legend">
      <li>
        <span className="gantt__key gantt__key--planned" />
        Planned
      </li>
      <li>
        <span className="gantt__key gantt__key--ai">
          <span />
        </span>
        AI share
      </li>
      <li>
        <span className="gantt__key gantt__key--hold" />
        On hold
      </li>
      <li>
        <span className="gantt__key gantt__key--red" />
        Violation (overload, pushed milestone, cross-project)
      </li>
      <li>
        <span className="gantt__key-diamond" />
        Fixed milestone
      </li>
      <li>
        <span className="gantt__key-diamond gantt__key-diamond--floating" />
        Floating milestone
      </li>
    </ul>
  )
}

const AVATAR_COLOURS = ['#EC4899', '#8B5CF6', '#0EA5E9', '#F97316', '#14B8A6', '#84CC16']

/** A colour of its own for each person's initials, the same every time. */
function avatarColour(id: string): string {
  let hash = 0
  for (const char of id) hash = (hash * 31 + char.charCodeAt(0)) >>> 0
  return AVATAR_COLOURS[hash % AVATAR_COLOURS.length]!
}

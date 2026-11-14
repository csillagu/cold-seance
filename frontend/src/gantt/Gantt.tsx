import {
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
  useRef,
  useState,
} from 'react'
import { daysDragged, movable } from './gantt-edit.ts'
import {
  addDays,
  type ApiTask,
  arrowPath,
  type BaselineBar,
  daysBetween,
  formatDay,
  formatMonth,
  type GanttDependency,
  type GanttModel,
  type GanttRow,
  type UnscheduledRow,
} from './gantt-model.ts'
import { avatarColour } from './avatar.ts'
import './gantt.css'

/** The width of a day on the timeline, and the height of a row, in pixels, as the design draws them. */
const DAY_WIDTH = 44
const ROW_HEIGHT = 40
/** The height of the heading row of the unscheduled tasks. */
const GROUP_HEIGHT = 32

/** Where a bar sits within its row, and how tall it is. */
const BAR_TOP = 8
const BAR_HEIGHT = 18
/** The half width of a milestone's diamond, from its centre to its tip. */
const DIAMOND = 11

/** How far, in pixels, a bar must be dragged before it counts as a move rather than a click. */
const CLICK_SLOP = 4

/** A person as the Gantt names them: by their username, from the project's members. */
export type PeopleById = ReadonlyMap<string, string>

/**
 * What the viewer can do on the Gantt (SC-067, FR-053): each is sent to the REST API by the page,
 * which allows or refuses it by the viewer's role in the task's project (FR-060).
 */
export interface GanttEditing {
  /** Moves `task`, drawn from `start`, by `days` days: its bar was dragged. */
  onMove: (task: ApiTask, start: string, days: number) => void
  /** Makes `task` blocked by `blocker`: a dependency was drawn from `blocker` to `task`. */
  onLink: (task: ApiTask, blocker: ApiTask) => void
  /** Opens the editor of `task`, for everything else it shows. */
  onOpen: (task: ApiTask) => void
}

/** A point in the timeline's pixels, from the top left of its first row. */
interface Point {
  x: number
  y: number
}

/** A drag under way: a bar being moved, or a dependency being drawn from a bar. */
type Drag =
  | { kind: 'move'; row: GanttRow; x0: number; dx: number; pointer: number }
  | { kind: 'link'; row: GanttRow; from: Point; to: Point; pointer: number }

interface GanttProps {
  /** What it is a Gantt of, for its accessible name. */
  name: string
  model: GanttModel
  people: PeopleById
  /** Today, `YYYY-MM-DD`: marked on the timeline if it lies within it. */
  today: string
  /** What the viewer can change on it; without it, the Gantt only shows. */
  editing?: GanttEditing
}

/**
 * The Gantt timeline (SC-031, DD-042): the tasks as bars on their dates, the dependencies between
 * them as arrows, the milestones as diamonds, and constraint violations and tasks whose assigned
 * people cannot do them in red (FR-049, FR-013, FR-020), as the approved design draws it (SRC-249).
 * A table of the tasks on the left, the timeline on the right; the panel scrolls sideways, with the
 * table kept in view. Below the scheduled tasks, the unscheduled ones (SC-064, FR-004, FR-145);
 * cancelled tasks are drawn faded (FR-129); a selected baseline's bars lie under the planned ones
 * (SC-065, FR-050).
 *
 * With `editing`, what it shows can be changed on it (SC-067, FR-053): a bar dragged sideways
 * moves its task by whole days, a line drawn from the handle at a bar's end to another task makes
 * that task blocked by it, and a click on a bar or a task's title opens its editor for the rest.
 */
export function Gantt({ name, model, people, today, editing }: GanttProps) {
  const { rows, unscheduled, days, dependencies, baseline } = model
  const [drag, setDrag] = useState<Drag | null>(null)
  const arrows = useRef<SVGSVGElement>(null)
  if (rows.length === 0 && unscheduled.length === 0) {
    return <p className="page__note">This project has no tasks yet.</p>
  }
  const first = days[0]?.date ?? today
  const timelineWidth = days.length * DAY_WIDTH
  const todayIndex = daysBetween(first, today)
  const showToday = todayIndex >= 0 && todayIndex < days.length
  const bodyHeight =
    rows.length * ROW_HEIGHT +
    (unscheduled.length > 0 ? GROUP_HEIGHT + unscheduled.length * ROW_HEIGHT : 0)

  /** Where the pointer is, in the timeline's pixels. */
  const pointAt = (event: ReactPointerEvent): Point => {
    const box = arrows.current?.getBoundingClientRect()
    return { x: event.clientX - (box?.left ?? 0), y: event.clientY - (box?.top ?? 0) }
  }
  const startMove = (row: GanttRow, event: ReactPointerEvent<HTMLElement>) => {
    if (!editing || event.button !== 0) return
    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    setDrag({ kind: 'move', row, x0: event.clientX, dx: 0, pointer: event.pointerId })
  }
  const startLink = (row: GanttRow, index: number, event: ReactPointerEvent<HTMLElement>) => {
    if (!editing || event.button !== 0) return
    event.preventDefault()
    event.stopPropagation()
    event.currentTarget.setPointerCapture(event.pointerId)
    const from = ends(row, index, first).out
    setDrag({ kind: 'link', row, from, to: pointAt(event), pointer: event.pointerId })
  }
  const onPointerMove = (event: ReactPointerEvent) => {
    if (!drag || event.pointerId !== drag.pointer) return
    if (drag.kind === 'move') setDrag({ ...drag, dx: event.clientX - drag.x0 })
    else setDrag({ ...drag, to: pointAt(event) })
  }
  const onPointerUp = (event: ReactPointerEvent) => {
    if (!drag || !editing || event.pointerId !== drag.pointer) return
    setDrag(null)
    const { task } = drag.row
    if (drag.kind === 'move') {
      const moved = Math.abs(drag.dx) >= CLICK_SLOP
      const by = movable(task, drag.row.parent) && moved ? daysDragged(drag.dx, DAY_WIDTH) : 0
      if (by !== 0) editing.onMove(task, drag.row.start, by)
      else if (!moved) editing.onOpen(task)
      return
    }
    const target = document
      .elementFromPoint(event.clientX, event.clientY)
      ?.closest<HTMLElement>('[data-task-id]')?.dataset['taskId']
    const blocked = [...rows, ...unscheduled].find((other) => other.task.id === target)?.task
    if (blocked && blocked.id !== task.id) editing.onLink(blocked, task)
  }
  const rowEditing = (row: GanttRow, index: number): RowEditing | undefined =>
    editing && {
      dx: drag?.kind === 'move' && drag.row.task.id === row.task.id ? drag.dx : 0,
      movable: movable(row.task, row.parent),
      onBarDown: (event) => startMove(row, event),
      onHandleDown: (event) => startLink(row, index, event),
      onOpen: () => editing.onOpen(row.task),
    }

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
          <div
            role="rowgroup"
            className={'gantt__body' + (drag ? ` gantt__body--${drag.kind}` : '')}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={() => setDrag(null)}
          >
            {rows.map((row, index) => (
              <TaskRow
                key={row.task.id}
                row={row}
                first={first}
                people={people}
                baseline={baseline}
                editing={rowEditing(row, index)}
              />
            ))}
            {unscheduled.length > 0 && (
              <div role="row" aria-label="Unscheduled" className="gantt__row gantt__group">
                <div role="rowheader" className="gantt__left gantt__group-left">
                  Unscheduled<span className="gantt__group-note">no planned dates</span>
                </div>
                <div className="gantt__group-lane" />
              </div>
            )}
            {unscheduled.map((row) => (
              <UnscheduledTaskRow
                key={row.task.id}
                row={row}
                first={first}
                people={people}
                baseline={baseline}
                onOpen={editing && (() => editing.onOpen(row.task))}
              />
            ))}
            <div
              className="gantt__overlay"
              aria-hidden="true"
              style={{ width: timelineWidth, height: bodyHeight }}
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
              svg={arrows}
              rows={rows}
              dependencies={dependencies}
              first={first}
              width={timelineWidth}
              height={bodyHeight}
              drawing={drag?.kind === 'link' ? drag : null}
            />
          </div>
        </div>
      </div>
      <Legend
        baseline={baseline}
        crossProject={dependencies.some((dependency) => dependency.crossProject)}
      />
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

/** What a bar says to a screen reader: the task, its dates, why it is red, and if it is cancelled. */
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
  const cancelled = task.status === 'cancelled' ? ', cancelled' : ''
  return `${task.title}: ${when}${red}${cancelled}`
}

/** A task's cells in the table on the left: its title, its assigned people, its start and days. */
function TaskCells({
  task,
  depth,
  parent,
  start,
  people,
  onOpen,
}: {
  task: GanttRow['task']
  depth: number
  parent: boolean
  /** The first day it is drawn on, or null for an unscheduled task. */
  start: string | null
  people: PeopleById
  /** Opens the task's editor, if the Gantt can be edited. */
  onOpen: (() => void) | undefined
}) {
  const assignees = task.assignees.map((id) => ({ id, name: people.get(id) }))
  return (
    <div className="gantt__left" style={{ paddingLeft: 16 + depth * 24 }}>
      <span role="cell" className={'gantt__title' + (parent ? ' gantt__title--parent' : '')}>
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
        {onOpen ? (
          <button
            type="button"
            className="gantt__title-text gantt__title-button"
            aria-label={`Edit ${task.title}`}
            onClick={onOpen}
          >
            {task.title}
          </button>
        ) : (
          <span className="gantt__title-text">{task.title}</span>
        )}
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
        {start === null ? <span className="gantt__none">—</span> : formatDay(start)}
      </span>
      <span role="cell" className="gantt__mono gantt__num">
        {task.milestone || task.durationWorkingDays === null ? (
          <span className="gantt__none">—</span>
        ) : (
          task.durationWorkingDays
        )}
      </span>
    </div>
  )
}

/** The bar of a task in the selected baseline, under its planned bar (FR-050). */
function BaselineBarOf({
  title,
  bar,
  name,
  first,
}: {
  title: string
  bar: BaselineBar
  name: string
  first: string
}) {
  const start = daysBetween(first, bar.start)
  const length = daysBetween(bar.start, bar.finish) + 1
  const label = `Baseline ${name} of ${title}: ${formatDay(bar.start, true)} to ${formatDay(bar.finish, true)}`
  return (
    <span
      role="img"
      aria-label={label}
      title={label}
      data-start={bar.start}
      data-finish={bar.finish}
      className="gantt__baseline"
      style={{ left: start * DAY_WIDTH + 4, width: length * DAY_WIDTH - 8 }}
    />
  )
}

/** What a row of the Gantt can be edited with, when the Gantt can be (SC-067). */
interface RowEditing {
  /** How far its bar is being dragged, in pixels; 0 when it is not. */
  dx: number
  /** Whether its bar can be dragged to other dates. */
  movable: boolean
  onBarDown: (event: ReactPointerEvent<HTMLElement>) => void
  onHandleDown: (event: ReactPointerEvent<HTMLElement>) => void
  onOpen: () => void
}

function TaskRow({
  row,
  first,
  people,
  baseline,
  editing,
}: {
  row: GanttRow
  first: string
  people: PeopleById
  baseline: string | null
  editing: RowEditing | undefined
}) {
  const { task } = row
  const start = daysBetween(first, row.start)
  const length = daysBetween(row.start, row.finish) + 1
  const cancelled = task.status === 'cancelled'

  return (
    <div
      role="row"
      aria-label={task.title}
      data-task-id={task.id}
      data-red={row.red}
      data-cancelled={cancelled}
      className={
        'gantt__row' +
        (row.red ? ' gantt__row--red' : '') +
        (cancelled ? ' gantt__row--cancelled' : '')
      }
    >
      <TaskCells
        task={task}
        depth={row.depth}
        parent={row.parent}
        start={row.start}
        people={people}
        onOpen={editing?.onOpen}
      />
      <div role="cell" className="gantt__lane">
        <Bar row={row} left={start * DAY_WIDTH} width={length * DAY_WIDTH} editing={editing} />
        {editing && editing.dx !== 0 && editing.movable && (
          <span
            role="status"
            className="gantt__drag-tip"
            style={{ left: (start + daysDragged(editing.dx, DAY_WIDTH)) * DAY_WIDTH }}
          >
            {formatDay(addDays(row.start, daysDragged(editing.dx, DAY_WIDTH)))}
          </span>
        )}
        {editing && (
          <span
            // Pointer only: the task's editor adds and removes blockers from the keyboard.
            aria-hidden="true"
            title={`Drag to the task that waits for ${task.title}`}
            className="gantt__link-handle"
            style={{ left: handleLeft(row, start, length) }}
            onPointerDown={editing.onHandleDown}
          />
        )}
        {baseline !== null && row.baseline && (
          <BaselineBarOf title={task.title} bar={row.baseline} name={baseline} first={first} />
        )}
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

/** An unscheduled task, below the scheduled ones: no bar, as it has no planned dates (FR-004). */
function UnscheduledTaskRow({
  row,
  first,
  people,
  baseline,
  onOpen,
}: {
  row: UnscheduledRow
  first: string
  people: PeopleById
  baseline: string | null
  onOpen: (() => void) | undefined
}) {
  const { task } = row
  const cancelled = task.status === 'cancelled'
  return (
    <div
      role="row"
      aria-label={task.title}
      data-task-id={task.id}
      data-unscheduled="true"
      data-cancelled={cancelled}
      className={'gantt__row' + (cancelled ? ' gantt__row--cancelled' : '')}
    >
      <TaskCells
        task={task}
        depth={0}
        parent={false}
        start={null}
        people={people}
        onOpen={onOpen}
      />
      <div role="cell" className="gantt__lane">
        <span className="gantt__unscheduled">No planned dates{cancelled ? ', cancelled' : ''}</span>
        {baseline !== null && row.baseline && (
          <BaselineBarOf title={task.title} bar={row.baseline} name={baseline} first={first} />
        )}
      </div>
    </div>
  )
}

/** Where the handle to draw a dependency from sits: just after the end of the bar. */
function handleLeft(row: GanttRow, start: number, length: number): number {
  if (row.task.milestone) return start * DAY_WIDTH + DAY_WIDTH / 2 + DIAMOND - 2
  return (start + length) * DAY_WIDTH - 9
}

function Bar({
  row,
  left,
  width,
  editing,
}: {
  row: GanttRow
  left: number
  width: number
  editing: RowEditing | undefined
}) {
  const { task } = row
  const label = barLabel(row)
  const common = {
    role: 'img',
    'aria-label': label,
    title: label,
    'data-start': row.start,
    'data-finish': row.finish,
    ...(editing && {
      'data-movable': editing.movable,
      onPointerDown: editing.onBarDown,
    }),
  }
  // A bar being dragged follows the pointer; it is saved, by whole days, when it is let go.
  const shift = editing?.movable ? editing.dx : 0
  if (task.milestone) {
    const variant = task.milestone.variant === 'floating' ? ' gantt__milestone--floating' : ''
    return (
      <span
        {...common}
        className={'gantt__milestone' + variant + (row.red ? ' gantt__milestone--red' : '')}
        style={{ left: left + DAY_WIDTH / 2 - 8 + shift }}
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
  const style: CSSProperties = { left: left + 4 + shift, width: width - 8 }
  return (
    <span
      {...common}
      className={
        'gantt__bar' +
        (task.status === 'on-hold' ? ' gantt__bar--hold' : '') +
        (row.red ? ' gantt__bar--red' : '') +
        (task.status === 'cancelled' ? ' gantt__bar--cancelled' : '')
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
  svg,
  rows,
  dependencies,
  first,
  width,
  height,
  drawing,
}: {
  svg: RefObject<SVGSVGElement | null>
  rows: readonly GanttRow[]
  dependencies: readonly GanttDependency[]
  first: string
  width: number
  height: number
  /** A dependency being drawn, from a bar to the pointer. */
  drawing: { from: Point; to: Point } | null
}) {
  const index = new Map(rows.map((row, i) => [row.task.id, i]))
  return (
    <svg
      ref={svg}
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
            aria-label={dependencyName(task, blocker, dependency)}
            data-red={dependency.red}
            data-cross-project={dependency.crossProject}
          >
            <path
              d={arrowPath(from, to, gap)}
              className={
                'gantt__arrow' +
                (dependency.red ? ' gantt__arrow--red' : '') +
                (dependency.crossProject ? ' gantt__arrow--cross-project' : '')
              }
              markerEnd={`url(#${dependency.red ? 'gantt-arrow-red' : 'gantt-arrow'})`}
            />
          </g>
        )
      })}
      {drawing && (
        <line
          x1={drawing.from.x}
          y1={drawing.from.y}
          x2={drawing.to.x}
          y2={drawing.to.y}
          className="gantt__arrow gantt__arrow--drawing"
          markerEnd="url(#gantt-arrow)"
        />
      )}
    </svg>
  )
}

/**
 * What a dependency's line says to a screen reader: which task is blocked by which, whether the
 * blocker is in another project (SC-066), and why it is red.
 */
function dependencyName(task: GanttRow, blocker: GanttRow, dependency: GanttDependency): string {
  const name = `${task.task.title} is blocked by ${blocker.task.title}`
  if (dependency.crossProject) {
    return (
      `${name}, of another project` +
      (dependency.red ? `, in red: it lies after the start of ${task.task.title}` : '')
    )
  }
  return name + (dependency.red ? ', in red: it pushes a fixed-date milestone' : '')
}

function Legend({ baseline, crossProject }: { baseline: string | null; crossProject: boolean }) {
  return (
    <ul className="gantt__legend" aria-label="Legend">
      <li>
        <span className="gantt__key gantt__key--planned" />
        Planned
      </li>
      {baseline !== null && (
        <li>
          <span className="gantt__key-baseline" />
          Baseline {baseline}
        </li>
      )}
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
        <span className="gantt__key gantt__key--cancelled" />
        Cancelled
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
      {crossProject && (
        <li>
          <span className="gantt__key-cross-project" />
          Cross-project dependency
        </li>
      )}
    </ul>
  )
}

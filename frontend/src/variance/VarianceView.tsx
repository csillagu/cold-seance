import type { CSSProperties } from 'react'
import type { Span, Timeline, VarianceModel, VarianceRow } from './variance-model.ts'
import './variance.css'

interface VarianceViewProps {
  /** The table's accessible name. */
  name: string
  model: VarianceModel
}

/** The position of a span on the timeline, as a share of its width. */
function place(span: Span, timeline: Timeline): CSSProperties {
  return {
    left: `${(span.from / timeline.days) * 100}%`,
    width: `${(span.days / timeline.days) * 100}%`,
  }
}

/** A variance as a tag: amber when later, green when earlier, plain otherwise. */
function Chip({ value }: { value: string }) {
  const kind = value.startsWith('+') ? 'later' : value.startsWith('−') ? 'earlier' : 'plain'
  return <span className={`variance__chip variance__chip--${kind}`}>{value}</span>
}

/** A row's bars on the timeline: planned, baseline under it, and actual so far under that. */
function Bars({ row, timeline }: { row: VarianceRow; timeline: Timeline }) {
  const { planned, baseline, actual, open } = row.bars
  return (
    <div className="variance__track" aria-hidden="true">
      {timeline.today !== null && (
        <span
          className="variance__today"
          style={{ left: `${((timeline.today + 0.5) / timeline.days) * 100}%` }}
        />
      )}
      {planned &&
        (row.milestone ? (
          <span
            className="variance__bar-milestone"
            style={{ left: `${((planned.from + 0.5) / timeline.days) * 100}%` }}
          />
        ) : (
          <span className="variance__bar-planned" style={place(planned, timeline)} />
        ))}
      {baseline && (
        <span
          className={row.milestone ? 'variance__bar-baseline-day' : 'variance__bar-baseline'}
          style={
            row.milestone
              ? { left: `${((baseline.from + 0.5) / timeline.days) * 100}%` }
              : place(baseline, timeline)
          }
        />
      )}
      {actual && (
        <span
          className={`variance__bar-actual${open ? ' variance__bar-actual--open' : ''}`}
          style={place(actual, timeline)}
        />
      )}
    </div>
  )
}

/** One task's row: its dates side by side, its variance and its bars. Nothing in it is editable. */
function Row({ row, timeline }: { row: VarianceRow; timeline: Timeline | null }) {
  const cancelled = row.status === 'cancelled'
  return (
    <tr
      aria-label={row.title}
      className={`variance__row${cancelled ? ' variance__row--cancelled' : ''}`}
      data-status={row.status}
    >
      <td className="variance__task">
        <span
          className="variance__title"
          style={{ paddingLeft: row.depth * 24 }}
          data-parent={row.subtasks > 0 ? 'true' : undefined}
        >
          {row.milestone ? (
            <svg
              className="variance__diamond"
              aria-hidden="true"
              width="12"
              height="12"
              viewBox="0 0 24 24"
            >
              <path d="M12 2l10 10-10 10L2 12z" />
            </svg>
          ) : (
            <span className={`variance__dot variance__dot--${row.status}`} aria-hidden="true" />
          )}
          <span className="variance__title-text">{row.title}</span>
          {row.note && <span className="variance__note">{row.note}</span>}
        </span>
      </td>
      <td className="variance__date" title={row.planned.full ?? undefined}>
        {row.planned.text}
      </td>
      <td
        className="variance__date variance__date--baseline"
        title={row.baseline.full ?? undefined}
      >
        {row.baseline.text}
      </td>
      <td className="variance__date" title={row.actual.full ?? undefined}>
        {row.actual.text}
      </td>
      <td className="variance__delta">
        <Chip value={row.start} />
      </td>
      <td className="variance__delta">{row.finish !== null && <Chip value={row.finish} />}</td>
      <td className="variance__timeline">{timeline && <Bars row={row} timeline={timeline} />}</td>
    </tr>
  )
}

/** A heading row of a group of tasks. */
function Group({ title, note }: { title: string; note?: string }) {
  return (
    <tr className="variance__group">
      <th scope="rowgroup" colSpan={7}>
        {title}
        {note && <span className="variance__group-note">{note}</span>}
      </th>
    </tr>
  )
}

/**
 * The baseline variance view (SC-033): each task's planned, baseline and actual dates side by side,
 * with each date's variance against the selected baseline (FR-152), as the approved design shows
 * it (SRC-249). Unscheduled tasks are shown too, in a group of their own (FR-004). It is read-only
 * (FR-052): it offers no control, and nothing in it reacts to a click, a double-click or a drag.
 */
export function VarianceView({ name, model }: VarianceViewProps) {
  const { summary, scheduled, unscheduled, timeline } = model
  return (
    <>
      <div className="variance__summary">
        <p className="variance__count">
          <span className="variance__count-value variance__count-value--later">
            {summary.later}
          </span>
          later than the baseline
        </p>
        <p className="variance__count">
          <span className="variance__count-value">{summary.on}</span>
          on the baseline
        </p>
        <p className="variance__count">
          <span className="variance__count-value variance__count-value--earlier">
            {summary.earlier}
          </span>
          earlier than the baseline
        </p>
        <p className="variance__count">
          <span className="variance__count-value variance__count-value--none">{summary.none}</span>
          with no baseline dates
        </p>
      </div>
      <div className="variance__frame">
        <table className="variance__table" aria-label={name}>
          <thead>
            <tr>
              <th scope="col">Task</th>
              <th scope="col" className="variance__date-head">
                Planned
              </th>
              <th scope="col" className="variance__date-head">
                Baseline {model.baseline}
              </th>
              <th scope="col" className="variance__date-head">
                Actual
              </th>
              <th scope="col" className="variance__delta">
                Start Δ
              </th>
              <th scope="col" className="variance__delta">
                Finish Δ
              </th>
              <th scope="col" className="variance__timeline">
                <span className="variance__visually-hidden">Timeline</span>
                {timeline && (
                  <span className="variance__weeks" aria-hidden="true">
                    {timeline.weeks.map((week) => (
                      <span
                        key={week.at}
                        className="variance__week"
                        style={{ left: `${(week.at / timeline.days) * 100}%` }}
                      >
                        {week.label}
                      </span>
                    ))}
                  </span>
                )}
              </th>
            </tr>
          </thead>
          <tbody>
            {scheduled.length > 0 && <Group title="Scheduled" />}
            {scheduled.map((row) => (
              <Row key={row.taskId} row={row} timeline={timeline} />
            ))}
            {unscheduled.length > 0 && <Group title="Unscheduled" note="no planned dates" />}
            {unscheduled.map((row) => (
              <Row key={row.taskId} row={row} timeline={timeline} />
            ))}
            {scheduled.length === 0 && unscheduled.length === 0 && (
              <tr>
                <td colSpan={7} className="variance__empty">
                  The project has no tasks.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <div className="variance__legend">
        <span className="variance__key">
          <span className="variance__key-planned" />
          Planned
        </span>
        <span className="variance__key">
          <span className="variance__key-baseline" />
          Baseline
        </span>
        <span className="variance__key">
          <span className="variance__key-actual" />
          Actual, so far
        </span>
        {timeline && timeline.today !== null && (
          <span className="variance__key">
            <span className="variance__key-today" />
            Today
          </span>
        )}
        <span className="variance__key">
          <span className="variance__chip variance__chip--later">+1</span>
          later
        </span>
        <span className="variance__key">
          <span className="variance__chip variance__chip--earlier">−1</span>
          earlier
        </span>
      </div>
    </>
  )
}

import {
  type PointerEvent as ReactPointerEvent,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react'
import type { TaskChanges } from '../tasks/TaskEditForm.tsx'
import type { BarSpan } from './gantt-edit.ts'
import {
  clampLabel,
  dayAt,
  drawChanges,
  drawnSpan,
  drawnWorkingDays,
  edgeScroll,
  placeChanges,
  spanText,
  workingDaysText,
} from './gantt-draw.ts'
import { formatDay, type GanttDay } from './gantt-model.ts'
import './gantt-draw.css'

/** How far, in pixels, the pointer must move while pressed before it counts as drawing. */
const DRAW_SLOP = 4

/** A drawing under way: the days it runs from and to, by index on the timeline. */
interface Drawing {
  pointer: number
  x0: number
  from: number
  to: number
  /** Whether the pointer has moved far enough to be drawing, not clicking. */
  moved: boolean
}

interface DrawLaneProps {
  /** What is drawn: a task's bar, or a fixed-date milestone's diamond, placed with a click. */
  mode: 'bar' | 'milestone'
  title: string
  days: readonly GanttDay[]
  dayWidth: number
  /** Called when the pointer is pressed on the lane, to select its task. */
  onPress: () => void
  /**
   * Saves `changes`, drawn on `span`, from the lane at `top` pixels down the viewport; resolves
   * true once saved, false if refused.
   */
  onDraw: (changes: TaskChanges, span: BarSpan, top: number) => Promise<boolean>
}

/**
 * The lane of an unscheduled task, drawn on to give it dates (#228). Over it, the cursor is a
 * crosshair and a faint day under the pointer shows where a bar would start. Pressed and dragged
 * either way, a ghost bar grows from the press to the pointer by whole days, with its start, its
 * finish and its working days above it, kept in view; the timeline scrolls when the pointer nears
 * its edge. Let go on the lane, the bar is saved, and shown as pending until it is; Escape, or
 * letting go off the lane, changes nothing, and so does a plain click. A fixed-date milestone is
 * placed with a click instead, on the day clicked.
 *
 * It is pointer only: the task dialog sets the dates from the keyboard. Only the day under the
 * pointer is kept in state, so it renders again only when that day changes.
 */
export function DrawLane({ mode, title, days, dayWidth, onPress, onDraw }: DrawLaneProps) {
  const [hover, setHover] = useState<number | null>(null)
  const [drawing, setDrawing] = useState<Drawing | null>(null)
  const [saving, setSaving] = useState<BarSpan | null>(null)
  const layer = useRef<HTMLDivElement>(null)
  const label = useRef<HTMLSpanElement>(null)
  /** The pointer's last place across the viewport, for scrolling while it does not move. */
  const pointerX = useRef(0)
  const frame = useRef<number | null>(null)
  const drawingRef = useRef<Drawing | null>(null)
  drawingRef.current = drawing

  /** The scrolling panel of the Gantt, and the part of it the timeline is seen in, across the viewport. */
  const view = useCallback(() => {
    const lane = layer.current?.parentElement
    const scroller = lane?.closest<HTMLElement>('.gantt__scroll') ?? null
    const left = lane?.previousElementSibling?.getBoundingClientRect().right ?? 0
    const right = scroller?.getBoundingClientRect().right ?? window.innerWidth
    return { scroller, from: Math.max(left, 0), to: Math.min(right, window.innerWidth) }
  }, [])

  const indexAt = useCallback(
    (clientX: number) => {
      const left = layer.current?.getBoundingClientRect().left ?? 0
      return dayAt(clientX - left, dayWidth, days.length)
    },
    [dayWidth, days.length],
  )

  /** Puts the label over the ghost bar, moved into the part of the timeline in view. */
  const placeLabel = useCallback(() => {
    const element = label.current
    const box = layer.current?.getBoundingClientRect()
    const current = drawingRef.current
    if (!element || !box || !current) return
    const { from, to } = view()
    const first = Math.min(current.from, current.to)
    const length = Math.abs(current.to - current.from) + 1
    const width = element.offsetWidth
    const ideal = (first + length / 2) * dayWidth - width / 2
    const left = clampLabel(ideal, width, from - box.left + 4, to - box.left - 4)
    element.style.left = `${left}px`
  }, [dayWidth, view])

  useLayoutEffect(placeLabel, [placeLabel, drawing])

  const stopScrolling = () => {
    if (frame.current !== null) cancelAnimationFrame(frame.current)
    frame.current = null
  }

  /** Scrolls the timeline while the pointer is near its edge, each frame, as long as it draws. */
  const scrollFrame = useCallback(() => {
    const current = drawingRef.current
    if (!current) {
      frame.current = null
      return
    }
    const { scroller, from, to } = view()
    const by = scroller ? edgeScroll(pointerX.current, from, to) : 0
    if (scroller && by !== 0) {
      scroller.scrollLeft += by
      const index = indexAt(pointerX.current)
      if (index !== current.to) setDrawing({ ...current, to: index })
      else placeLabel()
    }
    frame.current = requestAnimationFrame(scrollFrame)
  }, [indexAt, placeLabel, view])

  const cancel = useCallback(() => {
    stopScrolling()
    setDrawing(null)
  }, [])

  // Escape cancels a drawing under way.
  const active = drawing !== null
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (active && event.key === 'Escape') cancel()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [active, cancel])

  useEffect(() => stopScrolling, [])

  const nonWorking = (date: string) => days.find((day) => day.date === date)?.nonWorking ?? false
  const indexOf = (date: string) => days.findIndex((day) => day.date === date)

  const save = (span: BarSpan, changes: TaskChanges, top: number) => {
    setSaving(span)
    void onDraw(changes, span, top).finally(() => setSaving(null))
  }

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || saving !== null || days.length === 0) return
    event.preventDefault()
    event.currentTarget.setPointerCapture?.(event.pointerId)
    onPress()
    const index = indexAt(event.clientX)
    pointerX.current = event.clientX
    setHover(null)
    setDrawing({
      pointer: event.pointerId,
      x0: event.clientX,
      from: index,
      to: index,
      moved: false,
    })
    if (mode === 'bar' && frame.current === null) frame.current = requestAnimationFrame(scrollFrame)
  }

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (days.length === 0) return
    const index = indexAt(event.clientX)
    if (!drawing) {
      if (saving === null && index !== hover) setHover(index)
      return
    }
    if (event.pointerId !== drawing.pointer) return
    pointerX.current = event.clientX
    const moved = drawing.moved || Math.abs(event.clientX - drawing.x0) >= DRAW_SLOP
    if (index !== drawing.to || moved !== drawing.moved)
      setDrawing({ ...drawing, to: index, moved })
  }

  const onPointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!drawing || event.pointerId !== drawing.pointer) return
    cancel()
    const box = event.currentTarget.getBoundingClientRect()
    const { from, to } = view()
    const inside =
      event.clientY >= box.top &&
      event.clientY < box.bottom &&
      event.clientX >= Math.max(box.left, from) &&
      event.clientX < Math.min(box.right, to)
    if (!inside) return
    const at = days[indexAt(event.clientX)]!.date
    if (mode === 'milestone') {
      save({ start: at, finish: at }, placeChanges(at), box.top)
      return
    }
    // A plain click, with no drag, does nothing.
    if (!drawing.moved) return
    const span = drawnSpan(days[drawing.from]!.date, at)
    save(span, drawChanges(span, nonWorking), box.top)
  }
  const bar = (first: number, length: number) => ({
    left: first * dayWidth + 4,
    width: length * dayWidth - 8,
  })
  const diamond = (index: number) => ({ left: index * dayWidth + dayWidth / 2 - 8 })

  let ghost = null
  if (drawing && (drawing.moved || mode === 'milestone')) {
    const first = Math.min(drawing.from, drawing.to)
    const last = Math.max(drawing.from, drawing.to)
    if (mode === 'milestone') {
      ghost = (
        <span
          aria-hidden="true"
          className="gantt__milestone gantt__draw-ghost"
          data-draw="ghost"
          style={diamond(drawing.to)}
        />
      )
    } else {
      const span = { start: days[first]!.date, finish: days[last]!.date }
      ghost = (
        <>
          <span
            aria-hidden="true"
            className="gantt__bar gantt__draw-ghost"
            data-draw="ghost"
            data-start={span.start}
            data-finish={span.finish}
            style={bar(first, last - first + 1)}
          />
          <span ref={label} aria-hidden="true" className="gantt__draw-label" data-draw="label">
            <span>{formatDay(span.start)}</span>
            <span aria-hidden="true">→</span>
            <span>{formatDay(span.finish)}</span>
            <span className="gantt__draw-length">
              {workingDaysText(drawnWorkingDays(span, nonWorking))}
            </span>
          </span>
        </>
      )
    }
  }

  let pending = null
  if (saving) {
    const first = indexOf(saving.start)
    const name = `Saving ${title}: ${spanText(saving)}`
    pending =
      mode === 'milestone' ? (
        <span
          role="img"
          aria-label={name}
          className="gantt__milestone gantt__draw-saving"
          data-draw="saving"
          style={diamond(first)}
        />
      ) : (
        <span
          role="img"
          aria-label={name}
          className="gantt__bar gantt__draw-saving"
          data-draw="saving"
          data-start={saving.start}
          data-finish={saving.finish}
          style={bar(first, indexOf(saving.finish) - first + 1)}
        />
      )
  }

  const preview =
    hover !== null && !drawing && !saving ? (
      <span
        aria-hidden="true"
        className={
          mode === 'milestone'
            ? 'gantt__milestone gantt__draw-preview'
            : 'gantt__bar gantt__draw-preview'
        }
        data-draw="preview"
        style={mode === 'milestone' ? diamond(hover) : bar(hover, 1)}
      />
    ) : null

  return (
    <div
      ref={layer}
      // Pointer only: the task dialog, opened from the title, sets the dates from the keyboard.
      data-draw="lane"
      title={mode === 'milestone' ? `Click to place ${title}` : `Drag to schedule ${title}`}
      className={'gantt__draw' + (drawing ? ' gantt__draw--drawing' : '')}
      style={{ width: days.length * dayWidth }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={cancel}
      onPointerLeave={() => setHover(null)}
    >
      {preview}
      {ghost}
      {pending}
    </div>
  )
}

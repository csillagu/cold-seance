import './task-dialog.css'

/**
 * A task's title that opens the task dialog when clicked (#209), wherever a view lists a task: the
 * one way to reach a task's details and editor from any view.
 */
export function TaskTitleButton({
  title,
  className,
  onOpen,
}: {
  title: string
  className?: string
  onOpen: () => void
}) {
  return (
    <button
      type="button"
      className={'task-title-button' + (className ? ` ${className}` : '')}
      aria-label={`Open ${title}`}
      onClick={onOpen}
    >
      {title}
    </button>
  )
}

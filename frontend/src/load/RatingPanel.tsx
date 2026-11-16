import { describeExpression } from '../tasks/eligibility.ts'
import { TaskTitleButton } from '../tasks/TaskTitleButton.tsx'
import { type ApiRating, datesInWords, RATING_WORDS } from './load-model.ts'
import './load.css'

interface RatingPanelProps {
  ratings: readonly ApiRating[]
  /** The usernames of the people eligibility expressions name, by account id. */
  people: ReadonlyMap<string, string>
  /** Opens the task dialog of the task `taskId`: its title was clicked (#209). */
  onOpen: (taskId: string) => void
}

/**
 * The unassigned task rating panel of the person load view (SC-069): the project's tasks that
 * have eligible but no assigned people, each in red when every valid combination of eligible
 * people overloads someone, in amber when some do and others don't, and in green when none does
 * (FR-045, SRC-201), as the REST API rates them. Each says its colour in words too, so that it
 * does not rest on colour alone. Each task's title opens the task dialog (#209).
 */
export function RatingPanel({ ratings, people, onOpen }: RatingPanelProps) {
  return (
    <section className="load__panel" aria-label="Unassigned tasks">
      <h2 className="load__panel-title">Unassigned tasks</h2>
      {ratings.length === 0 ? (
        <p className="load__faint">No scheduled task is waiting for one of its eligible people.</p>
      ) : (
        <ul className="load__list">
          {ratings.map((rating) => {
            const words = RATING_WORDS[rating.rating]
            return (
              <li key={rating.taskId} className="load__item">
                <article aria-label={rating.title} className="load__item-body">
                  <span className={`load__rating load__rating--${rating.rating}`}>
                    {words.name}
                  </span>
                  <TaskTitleButton
                    title={rating.title}
                    className="load__item-title"
                    onOpen={() => onOpen(rating.taskId)}
                  />
                  <span className="load__faint">
                    {datesInWords(rating.plannedStart, rating.plannedFinish)}
                  </span>
                  <span className="load__faint">
                    Eligible:{' '}
                    {describeExpression(
                      rating.eligibility,
                      (id) => people.get(id) ?? 'Unknown person',
                    )}
                  </span>
                  <span className="load__meaning">{words.meaning}</span>
                </article>
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}

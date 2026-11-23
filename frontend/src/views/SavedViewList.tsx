import { Link } from 'react-router'
import { KIND_NAMES, placeOf, type SavedView, viewPath } from './saved-view.ts'

interface SavedViewListProps {
  /** What the list is of, for its accessible name. */
  name: string
  views: readonly SavedView[]
  projects: ReadonlyMap<string, string>
  groups: ReadonlyMap<string, string>
}

/** Where kept views come first: personal ones, then groups', then projects'. */
const PLACE_ORDER: Record<SavedView['keptIn'], number> = { personal: 0, group: 1, project: 2 }

/**
 * A list of saved views: each one's name, as a link that opens it, its kind and where it is kept.
 * The views are grouped by where they are kept, each place under a heading row of its own, so
 * that views of the same name kept in different places are told apart at a glance (#256).
 */
export function SavedViewList({ name, views, projects, groups }: SavedViewListProps) {
  if (views.length === 0) return <p className="page__note">No saved views yet.</p>
  const places = new Map<string, SavedView[]>()
  const sorted = [...views].sort(
    (a, b) =>
      PLACE_ORDER[a.keptIn] - PLACE_ORDER[b.keptIn] ||
      placeOf(a, projects, groups).localeCompare(placeOf(b, projects, groups)) ||
      a.name.localeCompare(b.name),
  )
  for (const view of sorted) {
    const place = placeOf(view, projects, groups)
    places.set(place, [...(places.get(place) ?? []), view])
  }
  return (
    <div className="account__scroll">
      <table className="account__table" aria-label={name}>
        <thead>
          <tr>
            <th scope="col">Name</th>
            <th scope="col">Kind</th>
            <th scope="col">Kept in</th>
          </tr>
        </thead>
        {[...places].map(([place, placed]) => (
          <tbody key={place}>
            {places.size > 1 && (
              <tr className="views__place-row">
                <th scope="rowgroup" colSpan={3}>
                  {place}
                </th>
              </tr>
            )}
            {placed.map((view) => (
              <tr key={view.id}>
                <th scope="row">
                  <Link className="app-link" to={viewPath(view)}>
                    {view.name}
                  </Link>
                </th>
                <td>{KIND_NAMES[view.kind]}</td>
                <td>{place}</td>
              </tr>
            ))}
          </tbody>
        ))}
      </table>
    </div>
  )
}

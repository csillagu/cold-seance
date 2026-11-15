import { Link } from 'react-router'
import { KIND_NAMES, placeOf, type SavedView, viewPath } from './saved-view.ts'

interface SavedViewListProps {
  /** What the list is of, for its accessible name. */
  name: string
  views: readonly SavedView[]
  projects: ReadonlyMap<string, string>
  groups: ReadonlyMap<string, string>
}

/** A list of saved views: each one's name, as a link that opens it, its kind and where it is kept. */
export function SavedViewList({ name, views, projects, groups }: SavedViewListProps) {
  if (views.length === 0) return <p className="page__note">No saved views yet.</p>
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
        <tbody>
          {views.map((view) => (
            <tr key={view.id}>
              <th scope="row">
                <Link to={viewPath(view)}>{view.name}</Link>
              </th>
              <td>{KIND_NAMES[view.kind]}</td>
              <td>{placeOf(view, projects, groups)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

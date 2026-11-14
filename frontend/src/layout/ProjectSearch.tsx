import { useEffect, useId, useRef, useState } from 'react'
import { Link, useLocation } from 'react-router'
import { api } from '../api.ts'
import { useSignInRedirect } from '../sign-in-redirect.ts'
import './project-search.css'

/** A project as the search gives it. */
interface FoundProject {
  id: string
  name: string
}

type Results =
  | { state: 'idle' }
  | { state: 'searching' }
  | { state: 'found'; projects: FoundProject[] }
  | { state: 'failed' }

/**
 * The project search bar in the layout's header (SC-114): a person types part of a project's name,
 * in any case, and is shown the matching projects they have access to (FR-183, FR-184), each a
 * link to the project. The search itself is the service layer's (SC-116), which also ignores the
 * spaces around the text (FR-188); text that is only spaces searches for nothing.
 *
 * Each change of the text searches afresh, dropping the answer to the one before. The results
 * close on Escape, when the focus leaves the search, and when the browser goes to another page.
 */
export function ProjectSearch() {
  const toSignIn = useSignInRedirect()
  const location = useLocation()
  const [text, setText] = useState('')
  const [open, setOpen] = useState(false)
  const [results, setResults] = useState<Results>({ state: 'idle' })
  const root = useRef<HTMLDivElement>(null)
  const resultsId = useId()
  const trimmed = text.trim()

  useEffect(() => {
    if (trimmed === '') {
      setResults({ state: 'idle' })
      return undefined
    }
    const abort = new AbortController()
    setResults({ state: 'searching' })
    api<FoundProject[]>(`/projects/search?text=${encodeURIComponent(trimmed)}`, {
      signal: abort.signal,
    }).then(
      (projects) => setResults({ state: 'found', projects }),
      (error: unknown) => {
        if (abort.signal.aborted || toSignIn(error)) return
        setResults({ state: 'failed' })
      },
    )
    return () => abort.abort()
  }, [trimmed, toSignIn])

  // Going to another page, a result's included, closes the results and clears the search.
  useEffect(() => {
    setOpen(false)
    setText('')
  }, [location.pathname])

  const shown = open && results.state !== 'idle'

  return (
    <div
      ref={root}
      className="project-search"
      role="search"
      aria-label="Projects"
      onBlur={(event) => {
        if (!root.current?.contains(event.relatedTarget)) setOpen(false)
      }}
      onKeyDown={(event) => {
        if (event.key === 'Escape') setOpen(false)
      }}
    >
      <input
        type="search"
        className="project-search__input"
        placeholder="Search projects"
        aria-label="Search projects"
        aria-controls={resultsId}
        aria-expanded={shown}
        autoComplete="off"
        value={text}
        onChange={(event) => {
          setText(event.target.value)
          setOpen(true)
        }}
        onFocus={() => setOpen(true)}
      />
      {shown && (
        <div id={resultsId} className="project-search__results">
          <SearchResults results={results} />
        </div>
      )}
    </div>
  )
}

function SearchResults({ results }: { results: Results }) {
  switch (results.state) {
    case 'idle':
      return null
    case 'searching':
      return <p className="project-search__note">Searching…</p>
    case 'failed':
      return <p className="project-search__note">The search failed. Try again.</p>
    case 'found':
      break
  }
  if (results.projects.length === 0) {
    return <p className="project-search__note">No project you can open matches.</p>
  }
  return (
    <ul className="project-search__list" aria-label="Matching projects">
      {results.projects.map((project) => (
        <li key={project.id}>
          <Link to={`/projects/${project.id}`} className="project-search__link">
            {project.name}
          </Link>
        </li>
      ))}
    </ul>
  )
}

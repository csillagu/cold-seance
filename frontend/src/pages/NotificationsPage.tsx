import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router'
import { api, ApiError } from '../api.ts'
import {
  type ApiNotification,
  LABEL_TONES,
  type Names,
  projectsNamed,
  taskOfLink,
  viewOf,
} from '../notifications/notification.ts'
import { type Subscriptions, subscriptionPath } from '../notifications/subscriptions.ts'
import { formatWhen } from '../proposals/proposal.ts'
import { useSignedIn } from '../signed-in.ts'
import { useSignInRedirect } from '../sign-in-redirect.ts'
import { TaskDialog } from '../tasks/TaskDialog.tsx'
import '../tasks/task-dialog.css'
import '../notifications/notifications.css'
import './pages.css'

type Loaded =
  | { state: 'loading' }
  | {
      state: 'loaded'
      notifications: ApiNotification[]
      subscriptions: Subscriptions
      names: Omit<Names, 'me'>
    }
  | { state: 'failed' }

/**
 * The names of what `notifications` name, from what the reader can read: the projects they list,
 * and in each of those that a notification names, its tasks' titles and its members' usernames.
 * What cannot be read is left out, and the notification says it in general words.
 */
async function namesFor(
  notifications: ApiNotification[],
  signal: AbortSignal | undefined,
): Promise<Omit<Names, 'me'>> {
  const projects = new Map<string, string>()
  const tasks = new Map<string, string>()
  const people = new Map<string, string>()
  const listed = await api<{ id: string; name: string }[]>('/projects', { signal })
  for (const project of listed) projects.set(project.id, project.name)
  const named = new Set(notifications.flatMap(projectsNamed).filter((id) => projects.has(id)))
  await Promise.allSettled(
    [...named].flatMap((id) => {
      const base = `/projects/${encodeURIComponent(id)}`
      return [
        api<{ id: string; title: string }[]>(`${base}/tasks`, { signal }).then((found) => {
          for (const task of found) tasks.set(task.id, task.title)
        }),
        api<{ accountId: string; username: string }[]>(`${base}/members`, { signal }).then(
          (found) => {
            for (const person of found) people.set(person.accountId, person.username)
          },
        ),
      ]
    }),
  )
  return { projects, tasks, people }
}

/**
 * The in-app notification list (SC-035), at `/notifications`: the signed-in person's
 * notifications, newest first, the only place the tool delivers them (FR-082, DD-003). Each says
 * what it is about and leads to it; one about a task opens the task dialog, as every view does
 * (#209). Reading them leaves them in place, as the REST API's read
 * does. Below them are the projects and issues the person is subscribed to (SC-093), each with
 * the control that ends the subscription; a project their role subscribes them to has none.
 */
export function NotificationsPage() {
  const toSignIn = useSignInRedirect()
  const me = useSignedIn()?.id
  const [loaded, setLoaded] = useState<Loaded>({ state: 'loading' })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  /** The task whose dialog is open, by id. */
  const [open, setOpen] = useState<string | null>(null)

  const load = useCallback(
    async (signal?: AbortSignal) => {
      try {
        const [notifications, subscriptions] = await Promise.all([
          api<ApiNotification[]>('/notifications', { signal }),
          api<Subscriptions>('/subscriptions', { signal }),
        ])
        const names = await namesFor(notifications, signal)
        setLoaded({ state: 'loaded', notifications, subscriptions, names })
      } catch (failure) {
        if (signal?.aborted || toSignIn(failure)) return
        setLoaded({ state: 'failed' })
      }
    },
    [toSignIn],
  )

  useEffect(() => {
    const abort = new AbortController()
    void load(abort.signal)
    return () => abort.abort()
  }, [load])

  /** Ends one subscription, then reads them afresh; a refusal is shown in the API's words. */
  const unsubscribe = async (path: string) => {
    setBusy(true)
    setError(null)
    try {
      await api(path, { method: 'DELETE' })
    } catch (failure) {
      if (toSignIn(failure)) return
      setError(
        failure instanceof ApiError ? failure.message : 'The change could not be saved. Try again.',
      )
    } finally {
      await load()
      setBusy(false)
    }
  }

  const title = <h1 className="page__title">Notifications</h1>
  switch (loaded.state) {
    case 'loading':
      return (
        <section>
          {title}
          <p className="page__note">Loading…</p>
        </section>
      )
    case 'failed':
      return (
        <section>
          {title}
          <p role="alert" className="page__note">
            The notifications could not be loaded.
          </p>
        </section>
      )
    case 'loaded':
      break
  }

  const names: Names = { me, ...loaded.names }
  const views = loaded.notifications.map((notification) => viewOf(notification, names))
  const { projects, issues } = loaded.subscriptions

  return (
    <section>
      {title}
      {views.length === 0 ? (
        <p className="page__note">You have no notifications.</p>
      ) : (
        <ul className="notifications__list" aria-label="Notifications">
          {views.map((view) => (
            <li key={view.id} className="notifications__item">
              <div className="notifications__meta">
                <span
                  className={`notifications__label notifications__label--${LABEL_TONES[view.label] ?? 'neutral'}`}
                >
                  {view.label}
                </span>
                <time dateTime={view.createdAt}>{formatWhen(view.createdAt)}</time>
              </div>
              <p className="notifications__text">
                <NotificationText link={view.link} text={view.text} onOpen={setOpen} />
              </p>
            </li>
          ))}
        </ul>
      )}

      <h2 className="notifications__heading" id="subscriptions-heading">
        Subscriptions
      </h2>
      <p className="page__note">
        Subscribe to a project on its page, and to a GitHub issue on its task&apos;s page.
      </p>
      {error ? (
        <p role="alert" className="subscription__error">
          {error}
        </p>
      ) : null}
      {projects.length === 0 && issues.length === 0 ? (
        <p className="page__note">You are subscribed to no project or issue.</p>
      ) : (
        <ul className="notifications__subscriptions" aria-labelledby="subscriptions-heading">
          {projects.map((project) => (
            <li key={project.projectId} className="notifications__subscription">
              <Link to={`/projects/${encodeURIComponent(project.projectId)}`}>{project.name}</Link>
              {project.automatic ? (
                <span className="subscription__note">Subscribed through your role</span>
              ) : (
                <button
                  type="button"
                  className="subscription__button subscription__button--quiet"
                  disabled={busy}
                  onClick={() =>
                    void unsubscribe(
                      subscriptionPath({
                        kind: 'project',
                        projectId: project.projectId,
                        name: project.name,
                      }),
                    )
                  }
                >
                  Unsubscribe from {project.name}
                </button>
              )}
            </li>
          ))}
          {issues.map((issue) => {
            const name = `${issue.repository.owner}/${issue.repository.name}#${issue.number}`
            return (
              <li key={issue.taskId} className="notifications__subscription">
                <Link to={`/tasks/${encodeURIComponent(issue.taskId)}`}>{name}</Link>
                <button
                  type="button"
                  className="subscription__button subscription__button--quiet"
                  disabled={busy}
                  onClick={() =>
                    void unsubscribe(
                      subscriptionPath({
                        kind: 'issue',
                        taskId: issue.taskId,
                        number: issue.number,
                      }),
                    )
                  }
                >
                  Unsubscribe from {name}
                </button>
              </li>
            )
          })}
        </ul>
      )}
      {open !== null && <TaskDialog taskId={open} onClose={() => setOpen(null)} />}
    </section>
  )
}

/** A notification's words, leading where it leads: a task's in the task dialog, the rest by link. */
function NotificationText({
  link,
  text,
  onOpen,
}: {
  link: string | null
  text: string
  onOpen: (taskId: string) => void
}) {
  const task = taskOfLink(link)
  if (task !== null) {
    return (
      <button type="button" className="task-title-button" onClick={() => onOpen(task)}>
        {text}
      </button>
    )
  }
  return link ? <Link to={link}>{text}</Link> : text
}

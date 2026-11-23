import { type FormEvent, useEffect, useState } from 'react'
import { api, ApiError } from '../api.ts'
import { useSignInRedirect } from '../sign-in-redirect.ts'
import { messageOf } from './accounts.ts'
import { dayWithWeekday, usePerson } from './availability.ts'
import './accounts.css'
import './availability.css'
import './pages.css'

/** A person's capacity, as `/api/accounts/<id>/capacity` gives it. */
interface Capacity {
  accountId: string
  capacity: number
}

/** An absence, as `/api/accounts/<id>/absences` lists it: whole days, `to` included. */
interface Absence {
  id: string
  accountId: string
  from: string
  to: string
}

/** What the screen shows once loaded. */
interface Shown {
  capacity: number
  absences: Absence[]
}

type Loaded =
  | { state: 'loading' }
  | ({ state: 'loaded' } & Shown)
  | { state: 'refused'; message: string }
  | { state: 'failed' }

/** Sorts absences as the API lists them: earliest first. */
function inOrder(absences: Absence[]): Absence[] {
  return absences.toSorted(
    (a, b) => a.from.localeCompare(b.from) || a.to.localeCompare(b.to) || a.id.localeCompare(b.id),
  )
}

/**
 * The capacity and absences screen (SC-088): a person sets their own capacity as a percentage of
 * full time (FR-037) and records their own absences, such as vacation or sick leave, in whole days
 * (FR-038, DD-011), at `/settings/capacity`; a system admin does the same for anyone at
 * `/accounts/<id>/capacity`, which account administration leads to (FR-150). The REST API decides
 * who may see and change what, and what a capacity or an absence may be.
 */
export function CapacityPage() {
  const { accountId, own, username } = usePerson()
  const toSignIn = useSignInRedirect()
  const [loaded, setLoaded] = useState<Loaded>({ state: 'loading' })
  const [capacity, setCapacity] = useState('')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [busy, setBusy] = useState(false)
  const [outcome, setOutcome] = useState<{ ok: boolean; text: string } | undefined>()

  useEffect(() => {
    if (accountId === undefined) return undefined
    const abort = new AbortController()
    const signal = abort.signal
    const base = `/accounts/${encodeURIComponent(accountId)}`
    setLoaded({ state: 'loading' })
    setOutcome(undefined)
    Promise.all([
      api<Capacity>(`${base}/capacity`, { signal }),
      api<Absence[]>(`${base}/absences`, { signal }),
    ]).then(
      ([read, absences]) => {
        setLoaded({ state: 'loaded', capacity: read.capacity, absences })
        setCapacity(String(read.capacity))
      },
      (error: unknown) => {
        if (signal.aborted || toSignIn(error)) return
        if (error instanceof ApiError && error.status < 500) {
          setLoaded({ state: 'refused', message: error.message })
        } else {
          setLoaded({ state: 'failed' })
        }
      },
    )
    return () => abort.abort()
  }, [accountId, toSignIn])

  /** Runs a change, and says how it went. */
  const change = async (run: () => Promise<string>) => {
    setBusy(true)
    try {
      setOutcome({ ok: true, text: await run() })
    } catch (error) {
      if (!toSignIn(error)) setOutcome({ ok: false, text: messageOf(error) })
    } finally {
      setBusy(false)
    }
  }

  const update = (next: (current: Shown) => Partial<Shown>) =>
    setLoaded((current) =>
      current.state === 'loaded' ? { ...current, ...next(current) } : current,
    )

  const setTheCapacity = (id: string, event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    void change(async () => {
      // The API refuses what is not a whole percentage from 0 to 100.
      const set = await api<Capacity>(`/accounts/${encodeURIComponent(id)}/capacity`, {
        method: 'PUT',
        body: { capacity: Number(capacity) },
      })
      update(() => ({ capacity: set.capacity }))
      setCapacity(String(set.capacity))
      return `Capacity set to ${set.capacity}%.`
    })
  }

  const record = (id: string, event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    void change(async () => {
      const created = await api<Absence>(`/accounts/${encodeURIComponent(id)}/absences`, {
        method: 'POST',
        body: { from, to },
      })
      update((current) => ({ absences: inOrder([...current.absences, created]) }))
      setFrom('')
      setTo('')
      return `Absence from ${created.from} to ${created.to} recorded.`
    })
  }

  const remove = (id: string, absence: Absence) =>
    void change(async () => {
      await api<null>(
        `/accounts/${encodeURIComponent(id)}/absences/${encodeURIComponent(absence.id)}`,
        { method: 'DELETE' },
      )
      update((current) => ({ absences: current.absences.filter((a) => a.id !== absence.id) }))
      return `Absence from ${absence.from} to ${absence.to} removed.`
    })

  const title = own
    ? 'Your capacity and absences'
    : username !== undefined
      ? `Capacity and absences of ${username}`
      : 'Capacity and absences'

  if (accountId === undefined || loaded.state === 'loading') {
    return (
      <section>
        <h1 className="page__title">{title}</h1>
        <p className="page__note">Loading…</p>
      </section>
    )
  }
  if (loaded.state === 'refused') {
    return (
      <section className="page__notice">
        <h1 className="page__notice-title">{title}</h1>
        <p className="page__note">{loaded.message}.</p>
      </section>
    )
  }
  if (loaded.state === 'failed') {
    return (
      <section>
        <h1 className="page__title">{title}</h1>
        <p role="alert" className="page__note">
          The capacity and absences could not be loaded.
        </p>
      </section>
    )
  }

  return (
    <section>
      <h1 className="page__title">{title}</h1>

      <form
        className="account__card account__form"
        aria-labelledby="set-capacity"
        onSubmit={(event) => setTheCapacity(accountId, event)}
      >
        <h2 className="account__card-title" id="set-capacity">
          Capacity
        </h2>
        {/* The saved capacity, in the card that changes it rather than above the page (#256). */}
        <p className="page__note account__current" data-testid="capacity">
          Capacity: {loaded.capacity}% of full time.
        </p>
        <div className="account__fields">
          <div className="account__field">
            <label htmlFor="capacity">Capacity (% of full time)</label>
            <input
              id="capacity"
              type="number"
              inputMode="numeric"
              min={0}
              max={100}
              step={1}
              required
              value={capacity}
              onChange={(event) => setCapacity(event.target.value)}
            />
          </div>
          <button type="submit" className="account__button" disabled={busy}>
            Set capacity
          </button>
        </div>
      </form>

      <form
        className="account__card account__form"
        aria-labelledby="record-absence"
        onSubmit={(event) => record(accountId, event)}
      >
        <h2 className="account__card-title" id="record-absence">
          Record an absence
        </h2>
        <p className="page__note availability__note">
          An absence, such as vacation or sick leave, is recorded in whole days, from its first day
          to its last, both included.
        </p>
        <div className="account__fields">
          <div className="account__field">
            <label htmlFor="absence-from">First day</label>
            <input
              id="absence-from"
              type="date"
              required
              value={from}
              onChange={(event) => setFrom(event.target.value)}
            />
          </div>
          <div className="account__field">
            <label htmlFor="absence-to">Last day</label>
            <input
              id="absence-to"
              type="date"
              required
              min={from === '' ? undefined : from}
              value={to}
              onChange={(event) => setTo(event.target.value)}
            />
          </div>
          <button type="submit" className="account__button" disabled={busy}>
            Record absence
          </button>
        </div>
      </form>

      {outcome !== undefined && (
        <p
          role={outcome.ok ? 'status' : 'alert'}
          className={outcome.ok ? 'account__done' : 'account__failed'}
        >
          {outcome.text}
        </p>
      )}

      {loaded.absences.length === 0 ? (
        <p className="page__note availability__after">No absences recorded.</p>
      ) : (
        <div className="account__scroll">
          <table className="account__table" aria-label="Absences">
            <thead>
              <tr>
                <th scope="col">First day</th>
                <th scope="col">Last day</th>
                <th scope="col">
                  <span className="account__hidden">Remove</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {loaded.absences.map((absence) => (
                <tr key={absence.id}>
                  <td>{dayWithWeekday(absence.from)}</td>
                  <td>{dayWithWeekday(absence.to)}</td>
                  <td className="account__end">
                    <button
                      type="button"
                      className="account__button account__button--danger"
                      disabled={busy}
                      aria-label={`Remove the absence from ${absence.from} to ${absence.to}`}
                      onClick={() => remove(accountId, absence)}
                    >
                      Remove
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}

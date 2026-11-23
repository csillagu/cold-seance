import { type FormEvent, useEffect, useState } from 'react'
import { api, ApiError } from '../api.ts'
import { useSignInRedirect } from '../sign-in-redirect.ts'
import { messageOf } from './accounts.ts'
import { dayWithWeekday, usePerson, weekendInWords } from './availability.ts'
import './accounts.css'
import './availability.css'
import './pages.css'

/** A person's own calendar, as `/api/accounts/<id>/calendar` gives it. */
interface PersonalCalendar {
  accountId: string
  holidays: string[]
}

/** The global calendar, as `/api/calendar` gives it. */
interface GlobalCalendar {
  weekendDays: string[]
  holidays: string[]
}

type Loaded =
  | { state: 'loading' }
  | { state: 'loaded'; holidays: string[]; weekendDays: string[] }
  | { state: 'refused'; message: string }
  | { state: 'failed' }

/**
 * The personal working calendar screen (SC-089): a person enters as many holidays as they want in
 * their own calendar (FR-039), at `/settings/calendar`; a system admin does the same for anyone at
 * `/accounts/<id>/calendar`, which account administration leads to (FR-150). It offers no weekend
 * setting: a person has no weekend of their own (FR-039), so the screen only says which days the
 * global calendar makes the weekend. The REST API decides who may see and change what.
 */
export function CalendarPage() {
  const { accountId, own, username } = usePerson()
  const toSignIn = useSignInRedirect()
  const [loaded, setLoaded] = useState<Loaded>({ state: 'loading' })
  const [day, setDay] = useState('')
  const [busy, setBusy] = useState(false)
  const [outcome, setOutcome] = useState<{ ok: boolean; text: string } | undefined>()

  useEffect(() => {
    if (accountId === undefined) return undefined
    const abort = new AbortController()
    const signal = abort.signal
    setLoaded({ state: 'loading' })
    setOutcome(undefined)
    Promise.all([
      api<PersonalCalendar>(`/accounts/${encodeURIComponent(accountId)}/calendar`, { signal }),
      api<GlobalCalendar>('/calendar', { signal }),
    ]).then(
      ([calendar, global]) =>
        setLoaded({
          state: 'loaded',
          holidays: calendar.holidays,
          weekendDays: global.weekendDays,
        }),
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

  /** Sends a change of the holidays, shows the calendar the API answers, and says how it went. */
  const change = async (
    id: string,
    body: { addHolidays?: string[]; removeHolidays?: string[] },
    done: string,
  ) => {
    setBusy(true)
    try {
      const calendar = await api<PersonalCalendar>(`/accounts/${encodeURIComponent(id)}/calendar`, {
        method: 'PATCH',
        body,
      })
      setLoaded((current) =>
        current.state === 'loaded' ? { ...current, holidays: calendar.holidays } : current,
      )
      setOutcome({ ok: true, text: done })
      return true
    } catch (error) {
      if (!toSignIn(error)) setOutcome({ ok: false, text: messageOf(error) })
      return false
    } finally {
      setBusy(false)
    }
  }

  const add = async (id: string, event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (await change(id, { addHolidays: [day] }, `Holiday on ${day} added.`)) setDay('')
  }

  const title = own
    ? 'Your working calendar'
    : username !== undefined
      ? `Working calendar of ${username}`
      : 'Working calendar'

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
          The working calendar could not be loaded.
        </p>
      </section>
    )
  }

  return (
    <section>
      <h1 className="page__title">{title}</h1>
      <p className="page__note" data-testid="weekend">
        The weekend is {weekendInWords(loaded.weekendDays)}, as the global calendar sets it for
        everyone; it cannot be changed here.
      </p>

      <form
        className="account__card account__form"
        aria-labelledby="add-holiday"
        onSubmit={(event) => void add(accountId, event)}
      >
        <h2 className="account__card-title" id="add-holiday">
          Add a holiday
        </h2>
        <div className="account__fields">
          <div className="account__field">
            <label htmlFor="holiday">Holiday</label>
            <input
              id="holiday"
              type="date"
              required
              value={day}
              onChange={(event) => setDay(event.target.value)}
            />
          </div>
          <button type="submit" className="account__button" disabled={busy}>
            Add holiday
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

      {loaded.holidays.length === 0 ? (
        <p className="page__note availability__after">No holidays entered.</p>
      ) : (
        <div className="account__scroll">
          <table className="account__table" aria-label="Holidays">
            <thead>
              <tr>
                <th scope="col">Holiday</th>
                <th scope="col">
                  <span className="account__hidden">Remove</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {loaded.holidays.map((holiday) => (
                <tr key={holiday}>
                  <td>{dayWithWeekday(holiday)}</td>
                  <td className="account__end">
                    <button
                      type="button"
                      className="account__button account__button--danger"
                      disabled={busy}
                      aria-label={`Remove the holiday on ${holiday}`}
                      onClick={() =>
                        void change(
                          accountId,
                          { removeHolidays: [holiday] },
                          `Holiday on ${holiday} removed.`,
                        )
                      }
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

import { type FormEvent, useEffect, useState } from 'react'
import { api, ApiError } from '../api.ts'
import { useSignedIn } from '../signed-in.ts'
import { useSignInRedirect } from '../sign-in-redirect.ts'
import { messageOf } from './accounts.ts'
import { DAYS_OF_THE_WEEK, dayWithWeekday, weekendInWords } from './availability.ts'
import './accounts.css'
import './availability.css'
import './company-calendar.css'
import './pages.css'

/** The global calendar, as `/api/calendar` gives it. */
interface GlobalCalendar {
  weekendDays: string[]
  holidays: string[]
}

/** A change of the global calendar, as `PATCH /api/calendar` takes it. */
interface GlobalCalendarChange {
  weekendDays?: string[]
  addHolidays?: string[]
  removeHolidays?: string[]
}

type Loaded =
  | { state: 'loading' }
  | { state: 'loaded'; calendar: GlobalCalendar }
  | { state: 'refused'; message: string }
  | { state: 'failed' }

const TITLE = 'Company calendar'

/**
 * The company calendar screen (SC-090), at `/company-calendar`: the one global calendar, the same
 * for everyone (FR-040), with its company holidays and the days of the week that are the weekend
 * (FR-131). A system admin adds and removes company holidays (FR-041) and chooses the weekend days
 * here; anyone else signed in sees the calendar but is offered no change. The REST API decides who
 * may change it, and refuses anyone but a system admin all the same.
 */
export function CompanyCalendarPage() {
  const signedIn = useSignedIn()
  const admin = signedIn?.systemAdmin === true
  const toSignIn = useSignInRedirect()
  const [loaded, setLoaded] = useState<Loaded>({ state: 'loading' })
  const [weekend, setWeekend] = useState<string[]>([])
  const [day, setDay] = useState('')
  const [busy, setBusy] = useState(false)
  const [outcome, setOutcome] = useState<{ ok: boolean; text: string } | undefined>()

  useEffect(() => {
    const abort = new AbortController()
    const signal = abort.signal
    api<GlobalCalendar>('/calendar', { signal }).then(
      (calendar) => {
        setLoaded({ state: 'loaded', calendar })
        setWeekend(calendar.weekendDays)
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
  }, [toSignIn])

  /** Sends a change, shows the calendar the API answers, and says how it went. */
  const change = async (body: GlobalCalendarChange, done: (c: GlobalCalendar) => string) => {
    setBusy(true)
    try {
      const calendar = await api<GlobalCalendar>('/calendar', { method: 'PATCH', body })
      setLoaded({ state: 'loaded', calendar })
      setWeekend(calendar.weekendDays)
      setOutcome({ ok: true, text: done(calendar) })
      return true
    } catch (error) {
      if (!toSignIn(error)) setOutcome({ ok: false, text: messageOf(error) })
      return false
    } finally {
      setBusy(false)
    }
  }

  const addHoliday = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (await change({ addHolidays: [day] }, () => `Company holiday on ${day} added.`)) setDay('')
  }

  const setWeekendDays = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    void change(
      { weekendDays: DAYS_OF_THE_WEEK.filter((d) => weekend.includes(d)) },
      (calendar) => `Weekend set to ${weekendInWords(calendar.weekendDays)}.`,
    )
  }

  if (loaded.state === 'loading') {
    return (
      <section>
        <h1 className="page__title">{TITLE}</h1>
        <p className="page__note">Loading…</p>
      </section>
    )
  }
  if (loaded.state === 'refused') {
    return (
      <section className="page__notice">
        <h1 className="page__notice-title">{TITLE}</h1>
        <p className="page__note">{loaded.message}.</p>
      </section>
    )
  }
  if (loaded.state === 'failed') {
    return (
      <section>
        <h1 className="page__title">{TITLE}</h1>
        <p role="alert" className="page__note">
          The company calendar could not be loaded.
        </p>
      </section>
    )
  }

  const { calendar } = loaded
  return (
    <section>
      <h1 className="page__title">{TITLE}</h1>
      <p className="page__note" data-testid="weekend">
        The weekend is {weekendInWords(calendar.weekendDays)}, for everyone.
      </p>
      {!admin && (
        <p className="page__note" data-testid="admins-only">
          Only system admins can change the company holidays and the weekend days.
        </p>
      )}

      {admin && (
        <form
          className="account__card account__form"
          aria-labelledby="set-weekend"
          onSubmit={setWeekendDays}
        >
          <h2 className="account__card-title" id="set-weekend">
            Weekend days
          </h2>
          <div className="account__fields">
            <fieldset className="company-calendar__days">
              <legend className="account__hidden">The days of the week that are the weekend</legend>
              {DAYS_OF_THE_WEEK.map((weekday) => (
                <label key={weekday} className="company-calendar__day">
                  <input
                    type="checkbox"
                    checked={weekend.includes(weekday)}
                    onChange={(event) =>
                      setWeekend((current) =>
                        event.target.checked
                          ? [...current, weekday]
                          : current.filter((d) => d !== weekday),
                      )
                    }
                  />
                  {weekendInWords([weekday])}
                </label>
              ))}
            </fieldset>
            <button type="submit" className="account__button" disabled={busy}>
              Set weekend days
            </button>
          </div>
        </form>
      )}

      {admin && (
        <form
          className="account__card account__form"
          aria-labelledby="add-company-holiday"
          onSubmit={(event) => void addHoliday(event)}
        >
          <h2 className="account__card-title" id="add-company-holiday">
            Add a company holiday
          </h2>
          <div className="account__fields">
            <div className="account__field">
              <label htmlFor="company-holiday">Company holiday</label>
              <input
                id="company-holiday"
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
      )}

      {outcome !== undefined && (
        <p
          role={outcome.ok ? 'status' : 'alert'}
          className={outcome.ok ? 'account__done' : 'account__failed'}
        >
          {outcome.text}
        </p>
      )}

      {calendar.holidays.length === 0 ? (
        <p className="page__note availability__after">No company holidays.</p>
      ) : (
        <div className="account__scroll">
          <table className="account__table" aria-label="Company holidays">
            <thead>
              <tr>
                <th scope="col">Company holiday</th>
                {admin && (
                  <th scope="col">
                    <span className="account__hidden">Remove</span>
                  </th>
                )}
              </tr>
            </thead>
            <tbody>
              {calendar.holidays.map((holiday) => (
                <tr key={holiday}>
                  <td className="account__mono">{dayWithWeekday(holiday)}</td>
                  {admin && (
                    <td className="account__end">
                      <button
                        type="button"
                        className="account__button account__button--danger"
                        disabled={busy}
                        aria-label={`Remove the company holiday on ${holiday}`}
                        onClick={() =>
                          void change(
                            { removeHolidays: [holiday] },
                            () => `Company holiday on ${holiday} removed.`,
                          )
                        }
                      >
                        Remove
                      </button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}

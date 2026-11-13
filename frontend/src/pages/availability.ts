import { useEffect, useState } from 'react'
import { useParams } from 'react-router'
import { api } from '../api.ts'
import { type SignedInAccount, useSignedIn } from '../signed-in.ts'

/** Whose availability a screen shows: the signed-in person's own, or someone else's. */
export interface Person {
  /** The account, or `undefined` while the signed-in person is not known yet. */
  accountId: string | undefined
  /** Whether it is the signed-in person's own. */
  own: boolean
  /** Their username, once known; `undefined` while loading or if it could not be read. */
  username: string | undefined
}

/**
 * The person a capacity, absences or calendar screen is about (SC-088, SC-089): the signed-in
 * person at `/settings/...`, or the account in the address at `/accounts/<id>/...`, which a system
 * admin opens from account administration (FR-150). Someone else's username comes from the account
 * list, which only system admins can read; the REST API decides who may see and change what.
 */
export function usePerson(): Person {
  const { accountId: other } = useParams()
  const signedIn = useSignedIn()
  const accountId = other ?? signedIn?.id
  const own = accountId !== undefined && accountId === signedIn?.id
  const [listed, setListed] = useState<{ id: string; username: string | undefined }>()

  useEffect(() => {
    if (own || accountId === undefined) return undefined
    const abort = new AbortController()
    api<SignedInAccount[]>('/accounts', { signal: abort.signal }).then(
      (accounts) =>
        setListed({
          id: accountId,
          username: accounts.find((account) => account.id === accountId)?.username,
        }),
      () => undefined,
    )
    return () => abort.abort()
  }, [accountId, own])

  const username = own
    ? signedIn?.username
    : listed?.id === accountId
      ? listed?.username
      : undefined
  return { accountId, own, username }
}

/** The days of the week as the API names them, Monday first, and as the screens show them. */
const DAY_NAMES: Record<string, string> = {
  monday: 'Monday',
  tuesday: 'Tuesday',
  wednesday: 'Wednesday',
  thursday: 'Thursday',
  friday: 'Friday',
  saturday: 'Saturday',
  sunday: 'Sunday',
}

/** The weekend days, as the global calendar lists them, in words: "Saturday and Sunday". */
export function weekendInWords(weekendDays: readonly string[]): string {
  const names = weekendDays.map((day) => DAY_NAMES[day] ?? day)
  if (names.length === 0) return 'no day'
  if (names.length === 1) return names[0] ?? ''
  return `${names.slice(0, -1).join(', ')} and ${names.at(-1) ?? ''}`
}

/** A day, `YYYY-MM-DD`, with its day of the week: "Mon 2027-03-08". */
export function dayWithWeekday(date: string): string {
  const [year, month, day] = date.split('-').map(Number)
  const weekday = new Date(
    Date.UTC(year ?? Number.NaN, (month ?? Number.NaN) - 1, day ?? Number.NaN),
  ).toLocaleDateString('en-GB', { weekday: 'short', timeZone: 'UTC' })
  return `${weekday} ${date}`
}

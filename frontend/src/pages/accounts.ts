import { ApiError } from '../api.ts'

/** What the account screens say when the REST API could not be reached or failed. */
export const UNAVAILABLE = 'The tool could not be reached. Try again.'

/** The message of a refused request, or that the tool could not be reached. */
export function messageOf(error: unknown): string {
  return error instanceof ApiError && error.status < 500 ? error.message : UNAVAILABLE
}

/**
 * When a token given the expiry date `date` (`YYYY-MM-DD`, from a date field) stops working: at the
 * end of that day in the browser's time zone, that is, the start of the next (SC-078).
 */
export function endOfDay(date: string): Date {
  const [year, month, day] = date.split('-').map(Number)
  return new Date(year ?? Number.NaN, (month ?? Number.NaN) - 1, (day ?? Number.NaN) + 1)
}

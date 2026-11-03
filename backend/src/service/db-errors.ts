import { DrizzleQueryError } from 'drizzle-orm'

/** Whether a database error is a violation of the given unique index (PostgreSQL's 23505). */
export function violates(error: unknown, index: string): boolean {
  const cause = error instanceof DrizzleQueryError ? error.cause : error
  return (
    typeof cause === 'object' &&
    cause !== null &&
    'code' in cause &&
    cause.code === '23505' &&
    'constraint' in cause &&
    cause.constraint === index
  )
}

import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  migrationError,
  removeMigrationsFolder,
  writeMigrationsFolder,
} from '../../test/helpers/migrations.ts'
import { applyMigrations, defaultMigrationsFolder, MigrationError } from './migrate.ts'

// Nothing listens on port 1, so a connection to it is refused at once.
const unreachable = 'postgres://cold:secret-password@127.0.0.1:1/cold'

const folders: string[] = []
function folder(...args: Parameters<typeof writeMigrationsFolder>) {
  const path = writeMigrationsFolder(...args)
  folders.push(path)
  return path
}

afterEach(() => {
  for (const path of folders.splice(0)) removeMigrationsFolder(path)
})

const createTable = { tag: '0000_create', when: 1, statements: ['CREATE TABLE "t" ("id" integer)'] }

describe('applyMigrations', () => {
  it("applies the backend's own migrations folder unless another is given", () => {
    expect(defaultMigrationsFolder).toBe(join(import.meta.dirname, '..', '..', 'drizzle'))
    // Its journal is committed, so the folder is never mistaken for a missing one.
    expect(existsSync(join(defaultMigrationsFolder, 'meta', '_journal.json'))).toBe(true)
  })

  it('refuses the start with a MigrationError when the database cannot be reached', async () => {
    const { message } = await migrationError(applyMigrations(unreachable, folder([createTable])))
    expect(message).toMatch(
      /^The database migrations could not be applied, so the tool does not start: /,
    )
    expect(message).toContain('ECONNREFUSED')
    // The address carries a password; the message must not echo it.
    expect(message).not.toContain('secret-password')
  })

  it("adds the cause's reason, where Drizzle puts PostgreSQL's", () => {
    const error = new MigrationError(
      new Error('Failed query: CREATE TABLE x', {
        cause: new Error('relation "x" already exists'),
      }),
    )
    expect(error.message).toBe(
      'The database migrations could not be applied, so the tool does not start: Failed query: CREATE TABLE x: relation "x" already exists',
    )
  })

  it('describes something thrown that is not an Error', () => {
    expect(new MigrationError('a string').message).toMatch(/does not start: a string$/)
  })

  it('names the code of an error that comes with no message', () => {
    // A connection refused on every address of a host comes as an AggregateError with no message.
    const refused = Object.assign(new AggregateError([], ''), { code: 'ECONNREFUSED' })
    expect(new MigrationError(refused).message).toMatch(/does not start: ECONNREFUSED$/)
  })

  it('falls back to the name of an error with neither message nor code', () => {
    expect(new MigrationError(new TypeError('')).message).toMatch(/does not start: TypeError$/)
  })
})

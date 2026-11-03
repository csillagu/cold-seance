import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { MigrationError } from '../../src/db/migrate.ts'

/** One migration as drizzle-kit writes it: a tag, the time it was generated, its SQL statements. */
export interface FixtureMigration {
  tag: string
  when: number
  statements: string[]
}

/**
 * Writes `migrations` to a fresh temporary folder in the layout drizzle-kit generates and Drizzle's
 * migrator reads (`meta/_journal.json` and one `<tag>.sql` per entry, statements separated by
 * breakpoints), and returns its path. Each call stands for one release's migrations folder.
 */
export function writeMigrationsFolder(migrations: readonly FixtureMigration[]): string {
  const folder = mkdtempSync(join(tmpdir(), 'cold-seance-migrations-'))
  mkdirSync(join(folder, 'meta'))
  writeFileSync(
    join(folder, 'meta', '_journal.json'),
    JSON.stringify({
      version: '7',
      dialect: 'postgresql',
      entries: migrations.map((m, idx) => ({
        idx,
        version: '7',
        when: m.when,
        tag: m.tag,
        breakpoints: true,
      })),
    }),
  )
  for (const m of migrations) {
    writeFileSync(join(folder, `${m.tag}.sql`), m.statements.join('\n--> statement-breakpoint\n'))
  }
  return folder
}

export function removeMigrationsFolder(folder: string): void {
  rmSync(folder, { recursive: true, force: true })
}

/** The `MigrationError` the attempt is expected to reject with; anything else fails the test. */
export async function migrationError(attempt: Promise<unknown>): Promise<MigrationError> {
  const error: unknown = await attempt.then(
    () => undefined,
    (e: unknown) => e,
  )
  if (!(error instanceof MigrationError)) {
    throw new Error(`expected a MigrationError, got ${String(error)}`)
  }
  return error
}

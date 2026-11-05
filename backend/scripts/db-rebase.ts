// `npm run db:rebase`: rebases the branch onto origin/main and regenerates its migration on top of
// main's (SC-073).
import { BACKEND_REBASE, rebaseMigrations } from './migration-rebase.ts'

process.exitCode = await rebaseMigrations(BACKEND_REBASE)

// `npm run db:check`: fails when the schema has a change that no migration holds (SC-073).
import { main } from './schema-drift.ts'

process.exitCode = await main()

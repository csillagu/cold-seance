// The Drizzle schema (DD-057). Each backend block adds its tables here and generates its
// migration with `npm run db:generate` (SC-073).
import { sql } from 'drizzle-orm'
import { boolean, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core'

/**
 * The accounts held in the tool itself (DD-027), which system admins create (FR-117, SC-015). A
 * password is kept only as its Argon2id hash (DD-056). A username is unique regardless of case, so
 * `erin` and `Erin` cannot be two people.
 */
export const accounts = pgTable(
  'accounts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    username: text('username').notNull(),
    passwordHash: text('password_hash').notNull(),
    systemAdmin: boolean('system_admin').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex('accounts_username_key').on(sql`lower(${table.username})`)],
)

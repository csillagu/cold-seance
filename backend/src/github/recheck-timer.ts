import { sql } from 'drizzle-orm'
import type { Database } from '../db/client.ts'
import { recheckRuns } from '../db/schema.ts'

export interface RecheckTimerOptions {
  /** The interval between runs, from the configuration (DD-059, SRC-213). */
  intervalMinutes: number
  /** The current time; the system clock unless given. */
  now?: () => Date
  /** Told of a run that failed as a whole, such as when the database cannot be reached. */
  onError?: (error: unknown) => void
}

/**
 * The key of the PostgreSQL advisory lock that one backend instance holds while it runs the
 * re-check (DD-051): a fixed number of the tool's own choosing.
 */
const RECHECK_LOCK = 7_310_024

/**
 * The longest a timer is set for: Node.js runs a timer of more than about 24.8 days at once, so
 * a longer wait is taken in steps.
 */
const MAX_WAIT_MS = 2 ** 31 - 1

/**
 * The re-check timer (SC-024, DD-051): a plain timer inside the backend process that runs the
 * re-check of linked issues at the configured interval. The time of the last run is stored in the
 * database (`recheck_runs`), so that on start the re-check runs at once only if the last run is
 * older than the interval, and a restart never skips one. A run takes a PostgreSQL advisory lock
 * for as long as it lasts, so that only one backend instance runs the re-check at a time; an
 * instance that finds the lock taken, or the last run recent, waits for the next one to be due.
 */
export class RecheckTimer {
  readonly #db: Database
  readonly #run: () => Promise<void>
  readonly #intervalMs: number
  readonly #now: () => Date
  readonly #onError: (error: unknown) => void
  #timer: NodeJS.Timeout | undefined
  #ticking: Promise<void> | undefined
  #stopped = true

  /** `run` is the re-check itself; it is called at most once at a time across instances. */
  constructor(db: Database, run: () => Promise<void>, options: RecheckTimerOptions) {
    this.#db = db
    this.#run = run
    this.#intervalMs = options.intervalMinutes * 60_000
    this.#now = options.now ?? (() => new Date())
    this.#onError = options.onError ?? (() => {})
  }

  /** Starts the timer: the re-check runs at once if it is due, and at each interval after. */
  start(): void {
    if (!this.#stopped) return
    this.#stopped = false
    this.#schedule(0)
  }

  /** Stops the timer, and resolves once a run under way has finished. */
  async stop(): Promise<void> {
    this.#stopped = true
    clearTimeout(this.#timer)
    this.#timer = undefined
    await this.#ticking
  }

  /**
   * Runs the re-check if it is due, that is, if no run is recorded or the last one started at
   * least the interval ago, and no other instance is running it. Answers whether it ran.
   */
  async tick(): Promise<boolean> {
    return this.#db.transaction(async (tx) => {
      // Held until the transaction ends: an instance that cannot take it leaves the run to the
      // one that holds it.
      const locked = await tx.execute<{ locked: boolean }>(
        sql`select pg_try_advisory_xact_lock(${RECHECK_LOCK}) as locked`,
      )
      if (locked.rows[0]?.locked !== true) return false
      const [last] = await tx.select().from(recheckRuns)
      const startedAt = this.#now()
      if (last !== undefined && startedAt.getTime() - last.lastRunAt.getTime() < this.#intervalMs)
        return false
      await this.#run()
      await tx
        .insert(recheckRuns)
        .values({ id: 1, lastRunAt: startedAt })
        .onConflictDoUpdate({ target: recheckRuns.id, set: { lastRunAt: startedAt } })
      return true
    })
  }

  /** How long until the next run is due, from the last run recorded; the interval if none is. */
  async #untilDue(): Promise<number> {
    const [last] = await this.#db.select().from(recheckRuns)
    if (last === undefined) return this.#intervalMs
    const due = last.lastRunAt.getTime() + this.#intervalMs - this.#now().getTime()
    return Math.max(0, due)
  }

  #schedule(ms: number): void {
    if (this.#stopped) return
    this.#timer = setTimeout(
      () => {
        this.#ticking = this.#ticked()
      },
      Math.min(ms, MAX_WAIT_MS),
    )
  }

  async #ticked(): Promise<void> {
    let wait = this.#intervalMs
    try {
      const ran = await this.tick()
      const due = await this.#untilDue()
      // Due, yet not run: another instance holds the lock and is running it. Ask again in a
      // minute, by when it has most likely finished and recorded its run.
      wait = ran || due > 0 ? due : 60_000
    } catch (error) {
      this.#onError(error)
    }
    // A run due again at once, as when the clock moved on during a long run, waits a second.
    this.#schedule(Math.max(wait, 1000))
  }
}

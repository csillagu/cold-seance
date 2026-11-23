/** A channel a change can come through, as the audit log records it (FR-116). */
export type Channel = 'ui' | 'rest-api' | 'mcp' | 'github'

/** An entry of the audit log as `/api/audit-log` hands it out (SC-013). */
export interface AuditEntry {
  id: number
  at: string
  /** An account, or for a change made on GitHub, the GitHub login of whoever made it there. */
  by: { accountId: string; username: string } | { githubLogin: string }
  /**
   * One channel, or two for a change an approved AI proposal applied: the proposal's channel,
   * then the approval's (FR-164).
   */
  channels: Channel[]
  projectId: string | null
  action: string
  subject: { type: string; id: string }
  details: Record<string, unknown>
}

const CHANNEL_NAMES: Record<Channel, string> = {
  ui: 'UI',
  'rest-api': 'REST API',
  mcp: 'MCP server',
  github: 'GitHub',
}

/** Who made the change, in words: the account's username, or a GitHub login marked as one. */
export function describeActor(by: AuditEntry['by']): string {
  return 'username' in by ? by.username : `${by.githubLogin} (GitHub)`
}

/** The name of a channel as the screen shows it; an unknown one as the API gives it. */
export function channelName(channel: string): string {
  return isChannel(channel) ? CHANNEL_NAMES[channel] : channel
}

function isChannel(channel: string): channel is Channel {
  return Object.hasOwn(CHANNEL_NAMES, channel)
}

/**
 * Through which channel a change came, in words: the one channel, or for a change an approved
 * AI proposal applied, the proposal's channel and the approval's.
 */
export function describeChannels(channels: readonly string[]): string {
  const [first, second] = channels
  if (first === undefined) return ''
  if (second === undefined) return channelName(first)
  return `${channelName(first)}, approved through ${channelName(second)}`
}

/** Words written in capitals, or in a capitalisation of their own, wherever they appear. */
const PROPER_WORDS: Record<string, string> = {
  ai: 'AI',
  api: 'API',
  github: 'GitHub',
  mcp: 'MCP',
  rest: 'REST',
  ui: 'UI',
}

function properWords(words: string): string {
  return words
    .split(' ')
    .map((word) => PROPER_WORDS[word.toLowerCase()] ?? word)
    .join(' ')
}

/**
 * What was done, in words, from the entry's `<subject type>.<verb>` action: `task.updated` reads
 * "Task updated", `project-member.role-set` "Project member role set", and `api-token.created`
 * "API token created" (#256).
 */
export function describeAction(action: string): string {
  const words = properWords(action.replaceAll(/[.-]/g, ' ').trim())
  return words.charAt(0).toUpperCase() + words.slice(1)
}

/**
 * A field name of the details in words: `plannedStart` reads "planned start". A name for an id
 * reads as what the id is of: `blockerId` "blocker", `projectIds` "projects" (#256).
 */
export function fieldName(name: string): string {
  const of = name.replace(/Ids$/, 's').replace(/(.)Id$/, '$1')
  return properWords(of.replaceAll(/([a-z0-9])([A-Z])/g, '$1 $2').toLowerCase())
}

/** The names of what ids stand for, by id, such as the projects the reader can see. */
export type Names = ReadonlyMap<string, string>

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * An id in words: the name it stands for, if known, or else its first eight characters, enough to
 * tell it from the others of the page (#256).
 */
export function formatId(id: string, names?: Names): string {
  return names?.get(id) ?? `#${id.slice(0, 8)}`
}

/**
 * A value of the details in words. An id is given by `formatId`; a nested record, such as the
 * cause of a change, reads as its fields in words, its action as `describeAction` reads it.
 */
export function formatValue(value: unknown, names?: Names): string {
  if (value === null || value === undefined) return 'none'
  if (typeof value === 'string') {
    if (value === '') return '(empty)'
    return UUID.test(value) ? formatId(value, names) : value
  }
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  if (Array.isArray(value)) {
    return value.length === 0 ? 'none' : value.map((item) => formatValue(item, names)).join(', ')
  }
  if (isRecord(value)) {
    return Object.entries(value)
      .map(([name, field]) =>
        name === 'action' && typeof field === 'string'
          ? describeAction(field).toLowerCase()
          : `${fieldName(name)} ${formatValue(field, names)}`,
      )
      .join(', ')
  }
  return JSON.stringify(value)
}

/** Whether two values of the details are the same, so that a change between them changes nothing. */
function same(a: unknown, b: unknown): boolean {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * The lines that tell what an entry changed, from its details. A change of fields, which the
 * service layer records as `changes` with the `previous` values, reads one line per field,
 * "title: Draft → Final", leaving out a field whose value stayed the same (#256); any other
 * detail reads "name: value". Ids read as the names in `names` where they are known.
 */
export function describeDetails(details: Record<string, unknown>, names?: Names): string[] {
  const { changes, previous, ...rest } = details
  if (!isRecord(changes) || !isRecord(previous)) {
    return Object.entries(details).map(
      ([name, value]) => `${fieldName(name)}: ${formatValue(value, names)}`,
    )
  }
  const lines = Object.entries(changes)
    .filter(([field, value]) => !(field in previous) || !same(previous[field], value))
    .map(([field, value]) =>
      field in previous
        ? `${fieldName(field)}: ${formatValue(previous[field], names)} → ${formatValue(value, names)}`
        : `${fieldName(field)}: ${formatValue(value, names)}`,
    )
  for (const [name, value] of Object.entries(rest)) {
    lines.push(`${fieldName(name)}: ${formatValue(value, names)}`)
  }
  return lines
}

/**
 * The line that says what an entry with no details of its own was about: its subject, by name
 * where known, "project: Apollo" (#256).
 */
export function describeSubject(subject: AuditEntry['subject'], names?: Names): string {
  return `${fieldName(subject.type)}: ${formatId(subject.id, names)}`
}

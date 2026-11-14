/** A channel a change can come through, as the audit log records it (FR-116). */
export type Channel = 'ui' | 'rest-api' | 'mcp' | 'github'

/** An entry of the audit log as `/api/audit-log` hands it out (SC-013). */
export interface AuditEntry {
  id: number
  at: string
  by: { accountId: string; username: string }
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

/**
 * What was done, in words, from the entry's `<subject type>.<verb>` action: `task.updated` reads
 * "Task updated", `project-member.role-set` "Project member role set".
 */
export function describeAction(action: string): string {
  const words = action.replaceAll(/[.-]/g, ' ').trim()
  return words.charAt(0).toUpperCase() + words.slice(1)
}

/** A field name of the details in words: `plannedStart` reads "planned start". */
export function fieldName(name: string): string {
  return name.replaceAll(/([a-z0-9])([A-Z])/g, '$1 $2').toLowerCase()
}

/** A value of the details in words. */
export function formatValue(value: unknown): string {
  if (value === null || value === undefined) return 'none'
  if (typeof value === 'string') return value === '' ? '(empty)' : value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  if (Array.isArray(value)) return value.length === 0 ? 'none' : value.map(formatValue).join(', ')
  return JSON.stringify(value)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * The lines that tell what an entry changed, from its details. A change of fields, which the
 * service layer records as `changes` with the `previous` values, reads one line per field,
 * "title: Draft → Final"; any other detail reads "name: value".
 */
export function describeDetails(details: Record<string, unknown>): string[] {
  const { changes, previous, ...rest } = details
  if (!isRecord(changes) || !isRecord(previous)) {
    return Object.entries(details).map(
      ([name, value]) => `${fieldName(name)}: ${formatValue(value)}`,
    )
  }
  const lines = Object.entries(changes).map(([field, value]) =>
    field in previous
      ? `${fieldName(field)}: ${formatValue(previous[field])} → ${formatValue(value)}`
      : `${fieldName(field)}: ${formatValue(value)}`,
  )
  for (const [name, value] of Object.entries(rest)) {
    lines.push(`${fieldName(name)}: ${formatValue(value)}`)
  }
  return lines
}

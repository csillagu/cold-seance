/**
 * The channels a change can come through, as the audit log records them (FR-116): the UI, the
 * REST API, the MCP server or GitHub.
 */
export const CHANNELS = ['ui', 'rest-api', 'mcp', 'github'] as const

export type Channel = (typeof CHANNELS)[number]

/**
 * The account a service-layer call is made for, and the channel it came through. Each channel
 * (the UI's sign-in session, the API tokens, the MCP server, GitHub's events) establishes both in
 * its own way and passes them in; the service layer makes the permission checks against the
 * account, so they are the same through every channel (DD-039, FR-115), and records the change in
 * the audit log with both (FR-116).
 */
export interface Caller {
  readonly accountId: string
  readonly channel: Channel
}

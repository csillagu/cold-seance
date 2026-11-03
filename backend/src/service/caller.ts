/**
 * The account a service-layer call is made for. Each channel (the UI's REST API, the API tokens,
 * the MCP server) establishes it in its own way and passes it in, and the service layer makes the
 * permission checks against it, so they are the same through every channel (DD-039, FR-115).
 */
export interface Caller {
  readonly accountId: string
}

import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { MCP_PATH } from '../../src/mcp/mcp.ts'

/** What a tool call answered: its JSON, and whether it is a refusal. */
export interface ToolAnswer<T = unknown> {
  isError: boolean
  /**
   * The JSON of the answer: what the tool read or made, as `T`, or, for a refusal, the error body.
   * Its shape is not checked: a test reads it as what it expects the tool to answer.
   */
  json: T
}

/** An MCP client connected to the MCP server (SC-027) at `baseUrl` with the token `secret`. */
export interface McpClient {
  /** The names of the tools the server offers. */
  toolNames(): Promise<string[]>
  call<T = unknown>(name: string, args?: Record<string, unknown>): Promise<ToolAnswer<T>>
  close(): Promise<void>
}

/**
 * Connects an MCP client, as an AI agent would, to the MCP server of the backend listening at
 * `baseUrl` (such as `http://127.0.0.1:41234`), over the Streamable HTTP transport, sending the
 * personal access token `secret` with each request (DD-048, DD-049).
 */
export async function connectMcp(baseUrl: string, secret: string): Promise<McpClient> {
  const client = new Client({ name: 'test-agent', version: '1.0.0' })
  const transport = new StreamableHTTPClientTransport(new URL(MCP_PATH, baseUrl), {
    requestInit: { headers: { authorization: `Bearer ${secret}` } },
  })
  await client.connect(transport)
  return {
    async toolNames() {
      return (await client.listTools()).tools.map((tool) => tool.name)
    },
    async call<T>(name: string, args: Record<string, unknown> = {}): Promise<ToolAnswer<T>> {
      const result = await client.callTool({ name, arguments: args })
      const content = Array.isArray(result.content) ? result.content : []
      const first: unknown = content[0]
      const text =
        typeof first === 'object' &&
        first !== null &&
        'text' in first &&
        typeof first.text === 'string'
          ? first.text
          : 'null'
      const json: T = JSON.parse(text)
      return { isError: result.isError === true, json }
    },
    close: () => client.close(),
  }
}

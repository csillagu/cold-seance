# DD-048: API access uses personal access tokens

## Decision

Each user creates their own API tokens in the tool. A token acts as that user, with that user's role in each project ([SRC-094](SRC-094-the-same-roles-apply-to-api-tokens-and-mcp-server.md)). It is a random secret shown once when created, stored only as a hash, revocable by its user, and may have an expiry date. MCP clients use the same tokens.

## Alternatives considered

Personal access tokens, OAuth 2.0 with the tool as its own authorisation server, or self-contained signed tokens (JWTs).

## Rationale

With local accounts only ([DD-027](DD-027-local-accounts-only-for-now.md)) there is no identity provider to hand authentication to, and running an OAuth server is a large build. Tokens stored as hashes are revoked the moment they are deleted, whereas a self-contained token stays valid until it expires.

## Trade-offs

No consent flow for third-party applications: users copy tokens by hand. Each request needs a database lookup to check its token. MCP clients that expect the MCP specification's OAuth flow must instead be configured with a token by hand.

## Risks

- A leaked token, for example one committed to a repository or pasted into an AI client's settings, gives its owner's access until it is revoked or expires.
- A token outlives changes to its owner unless each request checks the owner's current roles and whether the account is still active.
- Checking each token in the database adds load to every request.

## Serves

This decision serves [SRC-094](SRC-094-the-same-roles-apply-to-api-tokens-and-mcp-server.md), [SRC-077](SRC-077-rest-api-with-full-read-and-write-access.md), [SRC-078](SRC-078-mcp-server-reads-the-plan-and-writes-only-by-creat.md), [DD-027](DD-027-local-accounts-only-for-now.md).

Origin: proposed by Claude at the stakeholder's request in the design session of 2026-11-02 ("5-7 propose"). The alternatives, rationale and trade-offs are Claude's. Confirmed by the stakeholder in the design session of 2026-11-02: "1 confirmed". The Risks section was added by Claude afterwards, at the stakeholder's request ("Ok ok add risks"), and awaits the stakeholder's confirmation.

---
certainty: verified
source: design session
evidence: design session 2026-11-23
---

# SRC-292: Notifications are paged, read or unread, counted in the header, and an overload is one notification per run of days

A person's notifications:

- are shown a page at a time, the newest first, with a way to load more;
- are each unread until the person reads them, and can all be marked read at once; the header shows how many are unread;
- tell of a person's overload once for each run of consecutive overloaded days, not once for each day.

As received, in the design session of 2026-11-23, recorded in issue #256 (the UI/UX review of the demo deployment). Asked, about items 38 and 39 ("All notifications are on one page: 3,368 here", "Notifications have no read/unread state, and there is no count or badge in the header"), "What should change?", with the options "Read/unread + badge" ("Each notification is unread until the person reads it (or marks all read); the header shows the unread count. Needs a new stored state."), "Paging" ("Show the newest 50, with 'Load more'."), "Collapse overloads" ("One entry per person per run of overloaded days, not one per day.") and "Filter by kind", the owner chose "Paging", "Read/unread + badge" and "Collapse overloads".

Not stated: what reading a notification means (opening the page, or opening the notification); whether the read state is also given through the REST API and the MCP server ([SRC-017](SRC-017-the-api-and-mcp-server-can-read-notifications.md)).

---
certainty: assumed
effort: 2
---

# SC-113: Frontend layout

The layout of the React frontend ([DD-045](DD-045-the-frontend-uses-react-built-with-vite.md)): a header and navigation around the area in which the frontend's screens and views are shown ([SRC-219](SRC-219-the-frontend-layout-has-a-header-and-navigation-an.md)). The sign-in page is shown outside it. The screens and views are components of their own; this deliverable is the layout around them.

The header holds a search bar for projects and the signed-in person; clicking the signed-in person brings up settings, calendar and API tokens, each reachable from there ([SRC-220](SRC-220-the-header-holds-a-project-search-bar-and-the-sig.md)).

It is done when:

- every screen and view of the frontend, apart from the sign-in page, is shown inside the layout with its header and navigation, and the sign-in page is shown without them;
- a search in the header's search bar lists only projects the person has access to;
- the header shows the signed-in person, and clicking it brings up settings, calendar and API tokens, each of which opens from there.

What the navigation leads to is not stated. Which screens "settings" opens is not stated.

It delivers:

- [FR-183](FR-183-let-a-person-search-only-the-projects-they-can-re.md): Let a person search only the projects they can read

Origin: added by Claude for issue #15, at the owner's request in the design session of 2026-11-03 ("Add an sc for the layout"), after Claude noted that no SC covered the frontend's layout. The boundary and name are Claude's; it awaits the owner's confirmation. Effort: Claude's estimate. The owner confirmed it in the design session of 2026-11-03: "effort ok", before the search bar and the signed-in person's menu were added.

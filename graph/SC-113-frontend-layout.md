---
certainty: assumed
effort: 2
---

# SC-113: Frontend layout

The layout of the React frontend ([DD-045](DD-045-the-frontend-uses-react-built-with-vite.md)): a header and navigation around the area in which the frontend's pages, screens and views are shown ([SRC-219](SRC-219-the-frontend-layout-has-a-header-and-navigation-an.md)). The sign-in page is shown outside it. The header holds the project search bar (SC-114) and the signed-in person menu (SC-115), which are components of their own, as are the pages, screens and views; this deliverable is the layout around them.

It is done when every page, screen and view of the frontend, apart from the sign-in page, is shown inside the layout with its header and navigation and can be reached from the navigation, and the sign-in page is shown without them.

No FR states the layout, so this component delivers none.

Origin: added by Claude for issue #15, at the owner's request in the design session of 2026-11-03 ("Add an sc for the layout"), after Claude noted that no SC covered the frontend's layout. The quality review found SC-113 bundled, and in the design session of 2026-11-03 the owner answered "yes" to splitting it. It now holds the layout; the search bar and the signed-in person menu are SC-114 and SC-115. The boundary and name are Claude's; it awaits the owner's confirmation. Effort: Claude's estimate. The owner confirmed it in the design session of 2026-11-03: "effort ok", for the layout alone, before the search bar and the menu were added.

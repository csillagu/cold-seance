---
certainty: assumed
effort: 1
---

# SC-115: Signed-in person menu

The signed-in person shown in the header of the frontend's layout ([SC-113](SC-113-frontend-layout.md)), which, when clicked, brings up settings, calendar and API tokens ([SRC-221](SRC-221-clicking-the-signed-in-person-in-the-header-opens.md)). Settings opens the GitHub account link ([SC-077](SC-077-github-account-link-setting.md)) and the capacity and absences screen ([SC-088](SC-088-capacity-and-absences-screen.md)); API tokens opens the personal access token page ([SC-078](SC-078-personal-access-token-page.md)). Which screen calendar opens is not stated. It is part of the React frontend ([DD-045](DD-045-the-frontend-uses-react-built-with-vite.md)).

It is done when the header shows who is signed in, and clicking it brings up settings, calendar and API tokens, each of which opens its screen from there.

No FR states the menu, so this component delivers none.

Origin: split off from SC-113 by Claude for issue #15. The quality review found SC-113 bundled, and in the design session of 2026-11-03 the owner answered "yes" to splitting it. The boundary and name are Claude's; it awaits the owner's confirmation. Effort: Claude's estimate; it awaits the owner's confirmation.

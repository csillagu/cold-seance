---
certainty: verified
source: design session
evidence: design session 2026-10-31
---

# SRC-117: Creating a task in a cross-project view asks for its project

Creating a task in a view that covers several projects ([SRC-109](SRC-109-views-can-cover-several-projects.md)) asks which project it goes in. The choice offers only the projects the viewer can write to, through a direct role ([DD-034](DD-034-roles-are-assigned-per-project.md)) or a group ([SRC-139](SRC-139-project-access-also-comes-through-groups.md)). If the view's filter allows only one project, it uses that one.

Proposed in the design session and accepted: "perfect".

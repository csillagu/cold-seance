---
certainty: verified
source: design session
evidence: design session 2026-11-07
---

# SRC-249: The frontend looks as the approved design shows

The Kanban ([SRC-009](SRC-009-kanban-view.md)), the Gantt ([SRC-010](SRC-010-gantt-view.md)), the baseline variance view ([SRC-012](SRC-012-baseline-variance-view.md)) and the sign-in page ([SRC-223](SRC-223-the-sign-in-page-is-outside-the-layout.md)) look as the design in [`design/frontend/`](../design/frontend/) shows, in a light and a dark mode. The design has ten artboards, each screen in light and in dark:

- the Kanban of one project (`Main.dc.html`, `KanbanDark.dc.html`);
- a Gantt covering two projects (`Gantt.dc.html`, `GanttDark.dc.html`);
- the baseline variance view of one project (`Variance.dc.html`, `VarianceDark.dc.html`);
- the sign-in page (`SignIn.dc.html`, `SignInDark.dc.html`), and the same page after a failed sign-in (`SignInFailed.dc.html`, `SignInFailedDark.dc.html`).

The colours are the owner's:

- Dark mode: #0D0E12 page, #16181D card surfaces, #1F232B raised surfaces, 1px #262626 borders, #F9FAFB text, #9CA3AF muted text.
- Light mode: #F9FAFB page, #FFFFFF card surfaces, #F3F4F6 secondary surfaces, 1px #E5E7EB borders, #111827 text, #4B5563 muted text.
- Both: #6366F1 as the accent; red #EF4444, amber #F59E0B, blue #3B82F6 and green #10B981 as the semantic colours; Inter or Geist type, with monospace for identifiers; radii of 12px for cards, 8px for buttons and 4px for tags.

As received, in the design session of 2026-11-07. The owner first gave the colours above in a brief for a landing page, then asked instead for "an example for a gant chart and a kanban diagram, not this bullshitting marketing page. Read the repo on what a kanban board and a gantt chart should contain." Claude drew the two views from the items in the graph, and the owner asked for "both lingt AND dark mode, as per my earlier instudctions." Shown both modes, the owner answered: "great, perfect. Somehow incorporate this into the DD-s. This is how the thing should and will look like. Maybe not DD, and also, there is a gh issue for it", the issue being #111 (D01, the frontend design). The owner then asked: "lets design the sign in and the baseline variance screen too please", and, shown them, answered: "great as is, pleas make sure it is in reqlite. Commit push then open pr, which closes the issue".

Claude drew some details that no other item states, and the owner approved them only as part of the pictures: a parent task has its own Kanban card; a card shows no effort; the baseline variance view shows cancelled tasks faded, shows an unscheduled task's missing dates and variance as dashes, and has summary counts above its table; and the sign-in page has no way to reset a password. Not stated: how the design applies to the screens it does not draw, such as the person load view and the settings screens; and how a Kanban covering several projects groups its cards.

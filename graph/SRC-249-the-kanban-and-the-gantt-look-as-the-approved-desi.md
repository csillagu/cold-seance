---
certainty: verified
source: design session
evidence: design session 2026-11-07
---

# SRC-249: The Kanban and the Gantt look as the approved design shows

The Kanban ([SRC-009](SRC-009-kanban-view.md)) and the Gantt ([SRC-010](SRC-010-gantt-view.md)) look as the design in [`design/kanban-gantt/`](../design/kanban-gantt/) shows, in a light and a dark mode. The design has four artboards: the Kanban of one project and a Gantt covering two projects, each in light and in dark. `Main.dc.html` is the light Kanban, `Gantt.dc.html` the light Gantt, and `KanbanDark.dc.html` and `GanttDark.dc.html` draw the same two in the dark colours.

The colours are the owner's:

- Dark mode: #0D0E12 page, #16181D card surfaces, #1F232B raised surfaces, 1px #262626 borders, #F9FAFB text, #9CA3AF muted text.
- Light mode: #F9FAFB page, #FFFFFF card surfaces, #F3F4F6 secondary surfaces, 1px #E5E7EB borders, #111827 text, #4B5563 muted text.
- Both: #6366F1 as the accent; red #EF4444, amber #F59E0B, blue #3B82F6 and green #10B981 as the semantic colours; Inter or Geist type, with monospace for identifiers; radii of 12px for cards, 8px for buttons and 4px for tags.

As received, in the design session of 2026-11-07. The owner first gave the colours above in a brief for a landing page, then asked instead for "an example for a gant chart and a kanban diagram, not this bullshitting marketing page. Read the repo on what a kanban board and a gantt chart should contain." Claude drew the two views from the items in the graph, and the owner asked for "both lingt AND dark mode, as per my earlier instudctions." Shown both modes, the owner answered: "great, perfect. Somehow incorporate this into the DD-s. This is how the thing should and will look like. Maybe not DD, and also, there is a gh issue for it", the issue being #111 (D01, the frontend design).

What the design shows that no other item states was drawn by Claude and is approved only as a picture: a parent task has its own Kanban card, and a card shows no effort. Not stated: how the design applies to the screens it does not draw, such as the sign-in page, the person load view and the baseline variance view; and how a Kanban covering several projects groups its cards.

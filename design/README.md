# Frontend design

The approved look of the frontend, recorded in [SRC-249](../graph/SRC-249-the-kanban-and-the-gantt-look-as-the-approved-desi.md).

## `kanban-gantt/`

The Kanban and the Gantt, each in a light and a dark mode, exported from the design canvas they were drawn on (issue #111).

| File                 | Artboard                                  |
| -------------------- | ----------------------------------------- |
| `Main.dc.html`       | Kanban of project Apollo, light           |
| `KanbanDark.dc.html` | The same Kanban, dark                     |
| `Gantt.dc.html`      | Gantt covering Apollo and Borealis, light |
| `GanttDark.dc.html`  | The same Gantt, dark                      |
| `canvas.json`        | How the four artboards sit on the canvas  |

Each `.dc.html` file is plain HTML with inline styles. The colours are written as `{{t.<token>}}` holes; the token values for both modes are in the `themes` object of the script at the end of `Main.dc.html` and `Gantt.dc.html`. The dark files only import the light ones with `theme="dark"`. The files load the canvas editor's runtime (`./support.js`), which is not in this repository, so they are a reference to read, not pages to open.

The example data (Apollo, Borealis, alice, bob and the dates in March 2027) comes from the TCs in `graph/`.

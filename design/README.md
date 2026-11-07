# Frontend design

The approved look of the frontend, recorded in [SRC-249](../graph/SRC-249-the-frontend-looks-as-the-approved-design-shows.md).

## `frontend/`

The screens drawn so far, each in a light and a dark mode, exported from the design canvas they were drawn on (issue #111).

| File                       | Artboard                                   |
| -------------------------- | ------------------------------------------ |
| `Main.dc.html`             | Kanban of project Apollo, light            |
| `KanbanDark.dc.html`       | The same Kanban, dark                      |
| `Gantt.dc.html`            | Gantt covering Apollo and Borealis, light  |
| `GanttDark.dc.html`        | The same Gantt, dark                       |
| `Variance.dc.html`         | Baseline variance view of Apollo, light    |
| `VarianceDark.dc.html`     | The same view, dark                        |
| `SignIn.dc.html`           | Sign-in page, light                        |
| `SignInDark.dc.html`       | The same page, dark                        |
| `SignInFailed.dc.html`     | Sign-in page after a failed sign-in, light |
| `SignInFailedDark.dc.html` | The same, dark                             |
| `canvas.json`              | How the artboards sit on the canvas        |

Each `.dc.html` file is plain HTML with inline styles. The colours are written as `{{t.<token>}}` holes; the token values for both modes are in the `themes` object of the script at the end of `Main.dc.html`, `Gantt.dc.html`, `Variance.dc.html` and `SignIn.dc.html`. The other files only import one of those four with `theme="dark"` or `failed`. The files load the canvas editor's runtime (`./support.js`), which is not in this repository, so they are a reference to read, not pages to open.

The example data (Apollo, Borealis, alice, bob and the dates in February and March 2027) comes from the TCs in `graph/`.

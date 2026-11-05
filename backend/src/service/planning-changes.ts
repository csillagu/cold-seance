/**
 * Where the service layer tells of the tasks whose planning, as it is mirrored to GitHub, it has
 * changed (FR-089): their assignees, a fixed-date milestone's date, their parent or their
 * blockers. It is told after the change is committed, and must not throw or wait: the GitHub
 * planning mirror (SC-022) takes it from there in the background.
 */
export interface PlanningChanges {
  changed(taskIds: readonly string[]): void
}

/** Tells nobody: the service layer without a GitHub planning mirror. */
export const NO_PLANNING_CHANGES: PlanningChanges = { changed() {} }

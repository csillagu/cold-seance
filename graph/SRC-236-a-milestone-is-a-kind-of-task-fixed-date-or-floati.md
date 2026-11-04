---
certainty: verified
source: design session
evidence: design session 2026-11-04
---

# SRC-236: A milestone is a kind of task, fixed-date or floating

A milestone is a kind of task, chosen when the task is made. It is either pinned to a fixed date ([SRC-022](SRC-022-fixed-date-milestones-constraint.md)) or floating: done once the things it needs are done. Apart from that it is like any task, except that the Gantt shows it differently and it takes no time: it has no assignee, eligibility expression, duration, effort or AI share. It cannot have subtasks and cannot be a subtask. Once made, a task cannot be turned into a milestone or back, and a milestone cannot change between fixed-date and floating. Another project can depend on a milestone of either kind ([SRC-048](SRC-048-shared-milestones-one-owning-project-others-can-de.md)).

As received, in the design session of 2026-11-04, told that no item said what a milestone is or how it is stored: "So milestone is a type of task. There is a choice when making a task to set it to milestone. It is either fixed date or "as things needed for the milestone happens the milestone is done". Long story short it is exactly like w task, just has a different view in gant and has no assignee and task durstion."

Then, asked five questions:

1. Is a milestone a single day, or does it have a span? "No, it takes no time to finish."
2. Can another project depend on a floating milestone, or only on a fixed one? "yes of course."
3. Besides an assignee, does it also have no eligibility expression, effort or AI share? "egaztly none of those."
4. Can a milestone have subtasks, or be a subtask? "no and no"
5. Can it be turned back into a normal task, or change between fixed and floating, once made? "no"

Claude reads "floating" as the owner's second variant, the milestone that is done "as things needed for the milestone happens", and "the things it needs" as the tasks it is blocked by; the word "floating" is Claude's, from the design session's questions.

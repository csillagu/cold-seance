---
certainty: verified
source: design session
evidence: design session 2026-11-23
---

# SRC-280: The demo seeding runs in a GitHub environment of its own, approved by the owner

The demo seeding workflow ([SRC-279](SRC-279-demo-projects-are-seeded-into-the-test-deployment-.md)) and its keys are in a GitHub environment of their own, separate from `live`, with the owner as the approver of each run. For now its settings hold the same values as `live`'s. GitHub's free plan has no required reviewer on a private repository, so the environment has no approver until the repository is public.

As received, in the design session of 2026-11-23, on issue #257:

- "the thing is that this whole workflow (and the api keys whatever) needs to go into an environment on gh with me added as approver. (so separate from live, but currently using the same values)"
- Shown the plan (a workflow started by hand, in an environment `demo`, in the live tests' queue, deleting the live tests' projects with SQL run on the Neon database, then running the issue's seed script unchanged): "yes this looks good".
- Told that GitHub refused the required reviewer because the repository is private on the free plan, and asked how to go on, the owner chose: "No reviewer until public (Recommended)" ("Create `demo` now without the reviewer, so the workflow can run after the merge. The reviewer block stays in Terraform, commented, with a note to switch it on once the repository is public").

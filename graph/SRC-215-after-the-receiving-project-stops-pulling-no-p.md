---
certainty: verified
source: design session
evidence: design session 2026-11-03
---

# SRC-215: After the receiving project stops pulling, no project receives new issues

When a repository's receiving project ([SRC-177](SRC-177-one-receiving-project-per-repository-gets-its-new.md)) stops pulling issues from it, for example because its approval is withdrawn ([SRC-190](SRC-190-a-withdrawn-approval-stops-the-project-pulling-its.md)), no project receives the repository's new issues.

As received, in the design session of 2026-11-03, asked which project gets a repository's new issues after its receiving project stops pulling them: "1  none."

Not stated: whether issues opened in that time come into a project once another project is marked as the receiving one.

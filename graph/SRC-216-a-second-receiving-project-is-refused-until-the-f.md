---
certainty: verified
negotiability: immovable
source: design session
evidence: design session 2026-11-03
---

# SRC-216: A second receiving project is refused until the first gives it up

When a repository already has a receiving project ([SRC-177](SRC-177-one-receiving-project-per-repository-gets-its-new.md)), marking another project as its receiving project is refused, until the current receiving project gives it up.

As received, in the design session of 2026-11-03, asked what happens when the admin of a second project marks their project as receiving while another is already marked, with the options "New one replaces old" and "Refused" ("The second marking is refused until the current receiving project gives it up."): "Refused".

Not stated: who gives up the receiving role. FR-180 reads it as the admin of the receiving project, who marked it ([SRC-178](SRC-178-the-receiving-project-is-marked-by-a-project-admin.md)).

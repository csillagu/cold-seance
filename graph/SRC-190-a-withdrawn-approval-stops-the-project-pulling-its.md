---
certainty: verified
source: design session
evidence: design session 2026-11-02
---

# SRC-190: A withdrawn approval stops the project pulling; its tasks stay

When a repository admin withdraws a project's approval ([SRC-185](SRC-185-a-repository-admin-can-reject-a-project-s-request-.md)), the project keeps the tasks it already has from the repository and stops pulling issues from it. This holds when the project is the repository's receiving project ([SRC-177](SRC-177-one-receiving-project-per-repository-gets-its-new.md)): it stops pulling, so it stops receiving the repository's new issues.

As received, asked whether the project keeps the tasks it already has from the repository after its approval is withdrawn: "yes". Asked what happens when that project is the repository's receiving project, or when the receiving project stops pulling issues from the repository: "what do you mean ehat happens? Stops pulling yes when approval is lost".

Not stated: which project, if any, receives the repository's new issues after the receiving project stops pulling them.

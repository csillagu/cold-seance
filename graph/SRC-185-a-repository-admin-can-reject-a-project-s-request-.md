---
certainty: verified
source: design session
evidence: design session 2026-11-02
---

# SRC-185: A repository admin can reject a project's request or withdraw an approval

A repository's admin can reject a project's request to add the repository ([SRC-181](SRC-181-a-repository-s-admins-approve-adding-it-to-a-proje.md)), and can withdraw an approval given earlier. When an approval is withdrawn, the project stops pulling issues from the repository ([SRC-169](SRC-169-a-project-sets-which-repositories-it-pulls-issues.md)).

As received, asked whether a repository admin can reject a request or withdraw an approval later, and if so what then happens to that project's tasks from the repository: "yes". Asked then whether the project just stops pulling new issues from the repository, or whether more changes: "stops pulling". That the project keeps the tasks it already has from the repository was confirmed later; see SRC-190.

What happens when the withdrawn project is the repository's receiving project was answered later; see SRC-190.

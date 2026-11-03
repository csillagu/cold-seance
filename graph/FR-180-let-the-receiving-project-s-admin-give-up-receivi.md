---
certainty: assumed
---

# FR-180: Let the receiving project's admin give up receiving

The system must let the admin of a repository's receiving project give up that role, after which the repository has no receiving project until a project is marked again ([SRC-216](SRC-216-a-second-receiving-project-is-refused-until-the-f.md)). The admin who may do so is the receiving project's ([SRC-218](SRC-218-the-receiving-project-s-admin-gives-up-the-recei.md)).

It is done when, after that admin gives the role up, the repository has no receiving project and another project's admin can mark theirs, and when anyone else's attempt to give the role up is refused.

It serves [UC-025](UC-025-manage-a-project-s-members.md).

Origin: composed by Claude from the items linked above, for issue #11, from SRC-216: a second receiving project is refused until the first gives the role up. That the admin of the receiving project gives it up was confirmed in the same session (SRC-218). The wording is Claude's, not the stakeholder's; every obligation rests on a linked item.

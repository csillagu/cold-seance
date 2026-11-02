---
source: design session
evidence: design session 2026-10-31
---

# SRC-139: Project access also comes through groups

A group is a set of people, each holding a role in the group: read, contributor ([SRC-137](SRC-137-a-group-can-give-the-contributor-role.md)), write or admin. A project can belong to several groups, and a group can hold several projects. A group member holds their group role on every project in the group. A person can also hold a role on a project directly, as before ([DD-034](DD-034-roles-are-assigned-per-project.md)).

Reason given: shared views must be visible to the people who need them ([SRC-109](SRC-109-views-can-cover-several-projects.md)). Without groups, everyone would have to be added to each project before they could see its shared boards, which is painful. Adding several groups to a project fixes that.

Costs accepted: a more complicated system, and people still have to be added to each group one by one, which is laborious.

Rejected: every account can read every project by default, with a project marked private where needed.

Origin: first recorded as DD-028. Reclassified as an SRC at the stakeholder's suggestion, because the stakeholder set this access model; it was not the team's choice. Its rules on role precedence, creating groups, group visibility, adding projects and managing members were then split out into SRC-140 to SRC-144.

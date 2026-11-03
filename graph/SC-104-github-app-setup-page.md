---
certainty: assumed
effort: 2
---

# SC-104: GitHub App setup page

The page on which an admin sets up the installation's GitHub Apps ([DD-053](DD-053-each-installation-sets-up-its-own-github-apps-on-a.md)): for each function (reading issues, writing to issues, and the Projects status field) the admin either creates an App through the manifest flow or enters an App's id and private key by hand, and the page shows which App each function uses. Which admin may use it is not stated; Claude reads it as a system admin. It is part of the React frontend ([DD-045](DD-045-the-frontend-uses-react-built-with-vite.md)).

Origin: added by Claude for issue #11, after the owner chose how the tool connects to GitHub in the design session of 2026-11-02: "Gh app A". Entering Apps by hand, one App per function and the admin were added in the design session of 2026-11-03, from the owner's answers recorded in SRC-205 and SRC-206; the effort was estimated before that. The boundary and name are Claude's; it awaits the owner's confirmation. Effort: Claude's estimate, which the owner confirmed in the design session of 2026-11-02, answering "okay" to the proposed estimates.

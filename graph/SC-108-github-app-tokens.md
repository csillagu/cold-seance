---
certainty: assumed
effort: 2
---

# SC-108: GitHub App tokens

The backend module that holds the GitHub Apps given in the configuration, one per function or one for all ([DD-058](DD-058-github-access-uses-apps-registered-by-hand-with-op.md), [DD-059](DD-059-settings-come-from-a-yaml-file-overridable-by-envi.md)): for each App it signs requests with the App's private key, obtains the token of the App's installation on each repository, and keeps each token until shortly before it expires. It is done when, for every function and every repository the function's App is installed on, it returns a valid token, and when it reports which function's App is not installed on a repository the tool needs.

Origin: added by Claude for issue #11, split off from SC-106 after its quality review in the design session of 2026-11-03, following one App per function (SRC-207). The boundary and name are Claude's; it awaits the owner's confirmation. Effort: Claude's estimate, awaiting the owner's confirmation.

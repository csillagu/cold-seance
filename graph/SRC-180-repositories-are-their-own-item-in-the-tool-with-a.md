---
certainty: verified
source: design session
evidence: design session 2026-11-02
---

# SRC-180: Repositories are their own item in the tool, with admins

A GitHub repository is a separate item in the tool, and each repository has admins. It is the single place where access to a repository is decided, so that a better way of authorizing it can be added later. The GitHub App's permissions stay those of [SRC-099](SRC-099-the-github-app-is-installed-per-repo-by-the-repo-s.md); no repository administration permission is needed.

As received, after the drafting agent noted that anyone with an account can create a project and add to it any repository the GitHub App is installed on, whether or not they have access to it on GitHub: "Anyone can onboard a random repo they have no access to, which needs to be fixed I believe. But have no idea how. Manual approval is definitely out of picture." Then, proposing the fix: "Separate item (repository) in the tool. Repositorys have admins, those can approve adding them to projects." and "No repo admin permissions needed for the app, snd there is a single entry for later better authorization."

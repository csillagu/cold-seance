---
certainty: assumed
---

# SC-103: GitHub App setup flow

The backend function that creates the installation's GitHub App through GitHub's App manifest flow ([DD-053](DD-053-each-installation-creates-its-own-github-app-from.md)): it sends GitHub a manifest with the permissions the tool needs and its webhook address, takes the code GitHub returns, exchanges it for the App's id, private key and webhook secret, and stores them in the database. It is done when, after the flow, the tool can call GitHub as the new App and checks webhook deliveries against its secret.

Origin: added by Claude for issue #11, after the owner chose how the tool connects to GitHub in the design session of 2026-11-02: "Gh app A". The boundary and name are Claude's; it awaits the owner's confirmation. Effort: not stated; it awaits the owner's estimate.

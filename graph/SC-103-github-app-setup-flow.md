---
certainty: assumed
effort: 3
---

# SC-103: GitHub App setup flow

The backend function that sets up the installation's GitHub Apps ([DD-053](DD-053-each-installation-sets-up-its-own-github-apps-on-a.md)). To create an App through GitHub's App manifest flow, it sends GitHub a manifest with the permissions the tool needs and its webhook address, takes the code GitHub returns, exchanges it for the App's id, private key and webhook secret, and stores them in the database. For an App entered by hand, it stores the App's id and private key given for each function: reading issues, writing to issues, and the Projects status field. It is done when, after either way, the tool can call GitHub as the App given for each function, and checks webhook deliveries from a created App against its secret.

Origin: added by Claude for issue #11, after the owner chose how the tool connects to GitHub in the design session of 2026-11-02: "Gh app A". Entering Apps by hand and one App per function were added in the design session of 2026-11-03, from the owner's answers recorded in SRC-205; the effort was estimated before that. The boundary and name are Claude's; it awaits the owner's confirmation. Effort: Claude's estimate, which the owner confirmed in the design session of 2026-11-02, answering "okay" to the proposed estimates.

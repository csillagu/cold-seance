---
certainty: assumed
---

# SC-105: GitHub webhook endpoint

The Fastify route ([DD-044](DD-044-the-backend-uses-the-fastify-framework.md)) that receives the GitHub App's webhook deliveries, rejects any delivery whose signature does not match the webhook secret, and hands each accepted one to the GitHub change handler ([DD-053](DD-053-each-installation-creates-its-own-github-app-from.md)). It is done when a signed delivery reaches the change handler and an unsigned or wrongly signed one is rejected without any effect.

Origin: added by Claude for issue #11, after the owner chose how the tool connects to GitHub in the design session of 2026-11-02: "Gh app A". The boundary and name are Claude's; it awaits the owner's confirmation. Effort: not stated; it awaits the owner's estimate.

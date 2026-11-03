---
certainty: verified
source: design session
evidence: design session 2026-11-03
---

# SRC-230: Repository and organization webhooks are accepted when no App is used

When the installation uses no GitHub App, the tool also accepts webhooks set up on a repository or an organization on GitHub ([SRC-229](SRC-229-github-access-may-use-personal-access-tokens-beside.md)). Webhooks stay optional beside the hourly re-check ([SRC-209](SRC-209-github-webhooks-are-optional-beside-the-hourly-re.md)).

As received, in the design session of 2026-11-03, asked "Webhooks without an App: should the tool also accept webhooks set up on a repository or organisation when no App is used? Or is the hourly re-check alone fine?": "yes".

Asked whether such webhooks are also accepted when some functions use an App, as Claude proposed in DD-060, the owner confirmed it later in the same session: "proposals confirmed, mark DD-060 confirmed".

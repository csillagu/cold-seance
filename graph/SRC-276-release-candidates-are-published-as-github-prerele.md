---
certainty: verified
source: design session
evidence: design session 2026-11-23
---

# SRC-276: Release candidates are published as GitHub prereleases

A release whose version tag has a suffix, such as `v0.1.0-rc.1`, is published on GitHub as a prerelease, so that GitHub does not show a release candidate as the latest release. The release `v0.1.0-rc.1`, already published as a normal release, is marked as a prerelease too.

As received, in the design session of 2026-11-23, recorded in issue #242. Asked "The release workflow published v0.1.0-rc.1 as a normal release, so GitHub shows the release candidate as \"Latest\". Should tags with a suffix (v0.1.0-rc.1) be published as GitHub prereleases?", with the options "Yes, mark as prerelease" ("Add --prerelease to gh release create when the tag has a suffix, and mark rc.1 as a prerelease now") and "No, leave as is", the owner chose: "Yes, mark as prerelease (Recommended)".

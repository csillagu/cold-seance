---
certainty: verified
source: design session
evidence: design session 2026-11-22
---

# SRC-275: Docker images are published for each release, matching the Windows releases

The application image is released the way the Windows zip is: each release is published as an image too, named by its version. `latest` means the latest release. A release's image is tagged with its full version only, with no moving tags such as `0.1`. Release candidates are published as images too, but do not move `latest`. Builds of the main branch are still published, but only when started by hand, since the workflow does not run on the main branch, and are tagged `main`. Every image keeps its commit tag, `sha-<commit>`. The Compose file keeps running `latest`. The form of the version tag, such as `v0.1.0` or `0.1.0`, is left to Claude.

As received, in the design session of 2026-11-22, recorded in issue #249:

- Told that the Docker images have no version tags, while the Windows zip is released for each version tag: "Yes I want them mqtched."
- Asked what `latest` means: "latest release".
- Asked whether builds of the main branch should still be published: "Yes, they should be published too. But that can only happen manually as the workflow is not running on main".
- Asked which tags a release gets: "full".
- Asked whether release candidates are published as images: "yes, but thes shouldnt get latest".
- Asked whether to keep the `sha-<commit>` tags: "yes".
- Asked for the tag of a build of the main branch: "main".
- Asked whether the Compose file keeps `:latest` or names each release's version: "latest".
- Asked whether the tag's form is `v0.1.0` or `0.1.0`: "i dont care, make a decision".

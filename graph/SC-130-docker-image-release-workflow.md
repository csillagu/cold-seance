---
certainty: assumed
effort: 2
---

# SC-130: Docker image release workflow

The workflow that publishes the application image (SC-028) to the GitHub Container Registry, for linux/amd64 and linux/arm64, with the tags [DD-040](DD-040-the-tool-ships-as-one-application-image-run-with-p.md) gives it:

- On each version tag pushed, it builds the image from the tagged commit, the commit the Windows release workflow (SC-124) publishes the zip from, tests it as CI tests the image, and publishes it tagged with the version and the commit. A final release also moves `latest`, unless a final release of a higher version was tagged before it. A release candidate does not move it.
- When CI is started by hand on the main branch and every check has passed, it publishes that build of the main branch tagged `main` and with its commit.

It is done when pushing a final version tag publishes an image under that version and `latest`, pushing a release-candidate tag publishes one under its own version only, a manual run of CI on the main branch publishes one under `main`, and each carries its commit tag.

Origin: derived by Claude from [DD-040](DD-040-the-tool-ships-as-one-application-image-run-with-p.md) for issue #249, which asks for the image to be released as the Windows zip is ([SRC-275](SRC-275-docker-images-are-published-for-each-release-match.md)). The boundary, name and the "done when" are Claude's; it awaits the owner's confirmation. Effort: Claude's estimate; it awaits the owner's confirmation.

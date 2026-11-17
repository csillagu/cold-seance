---
certainty: assumed
effort: 2
---

# SC-124: Windows release workflow with code signing

The workflow that publishes the Windows zip ([DD-061](DD-061-the-tool-also-ships-for-windows-as-a-portable-zip-.md)): on each version tag pushed, it builds and tests the zip with the Windows CI job (SC-123), has its contents signed through the free open-source code-signing service, and publishes a GitHub Release for the tag with the zip attached. Until the project is accepted by the signing service and the workflow is given its settings, the workflow publishes the zip unsigned and says so in the release.

It is done when pushing a version tag publishes a release holding the zip that passed the Windows CI job, signed once the signing settings are given.

Origin: derived by Claude from [DD-061](DD-061-the-tool-also-ships-for-windows-as-a-portable-zip-.md) for issue #235. The boundary, name and the "done when" are Claude's, and so is publishing unsigned until signing is set up; it awaits the owner's confirmation. Effort: Claude's estimate; it awaits the owner's confirmation.

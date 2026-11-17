---
certainty: assumed
effort: 2
---

# SC-123: Windows package CI job

The CI job, run on a Windows machine for every pull request, that builds the Windows zip (SC-120) and tests it against a PostgreSQL installed natively on that machine ([DD-061](DD-061-the-tool-also-ships-for-windows-as-a-portable-zip-.md)). The tests check the zip, the service (SC-121) and the backup script (SC-122) as their "done when" says. The job keeps the zip as the run's artifact, which the release workflow (SC-124) publishes.

It is done when a pull request that breaks the zip's start, the service's clean stop or the backup script fails CI.

Origin: derived by Claude from [DD-061](DD-061-the-tool-also-ships-for-windows-as-a-portable-zip-.md) for issue #235, whose Testing section asks for a Windows job. The boundary, name and the "done when" are Claude's; it awaits the owner's confirmation. Effort: Claude's estimate; it awaits the owner's confirmation.

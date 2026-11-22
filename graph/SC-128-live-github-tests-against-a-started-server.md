---
certainty: assumed
effort: 2
---

# SC-128: Live GitHub tests against a started server

The command that runs the live GitHub test suite (SC-126) against real GitHub and the test repository, with a backend the run starts itself instead of the test deployment ([DD-063](DD-063-the-live-suite-runs-against-a-server-it-starts.md), [SRC-272](SRC-272-the-live-github-tests-also-run-against-a-server.md), [SRC-273](SRC-273-the-live-tests-against-a-started-server-run-in-ci-o.md)). Its global setup creates a fresh database on the PostgreSQL server the integration tests use, starts the backend on it with the deployment's GitHub App and classic Projects token, a re-check every minute and a first system admin of the run's own, gives the tests its address and admin, and when the run ends stops it and drops the database. It runs every test of the suite except TC-147, which needs a webhook (#245). The suite's command for the deployment keeps running against the deployment only; neither command falls back to the other.

It is done when, run with the settings the developer documentation names and a test repository prepared as it says, every test it runs passes and the run leaves no open issue and no milestone of its own in the test repository; and when, with a setting missing, it stops before starting the server, naming every missing one.

Origin: derived by Claude from [DD-063](DD-063-the-live-suite-runs-against-a-server-it-starts.md) for issue #239. The boundary, name and the "done when" are Claude's; it awaits the owner's confirmation. Effort: Claude's estimate; it awaits the owner's confirmation. For issue #244, the instructions moved out of the README into the developer documentation, as contributor material, [SRC-274](SRC-274-the-readme-is-an-overview-for-users-with-detailed-.md); the deliverable is otherwise unchanged.

---
certainty: assumed
effort: 3
---

# SC-120: Windows portable zip

The portable zip that installs the tool natively on Windows ([DD-061](DD-061-the-tool-also-ships-for-windows-as-a-portable-zip-.md)), and the script that builds it. The zip holds Node.js's Windows runtime and its licence, the built backend and frontend, the backend's run-time dependencies, its migrations, the example configuration and a start script. These are laid out as in the application image, so the backend finds its frontend and its migrations where it always does. The start script starts the backend from the folder the zip was unpacked into, wherever that is. The parts the zip packages are components of their own; this deliverable is the packaging, and the instructions for installing, configuring and starting it on Windows, in the user guide's Windows installation guide. The instructions cover installing PostgreSQL, where the configuration file goes and how to restrict who can read it and the key files with Windows file permissions.

It is done when the zip, unpacked into a folder whose path has spaces in it and configured with the address of an empty PostgreSQL database, starts with its start script, brings the database's schema up to date, and serves the frontend and the REST API on `127.0.0.1:3000`.

It delivers:

- [FR-177](FR-177-use-the-postgresql-database-given-in-the-configura.md): Use the PostgreSQL database given in the configuration

Origin: derived by Claude from [DD-061](DD-061-the-tool-also-ships-for-windows-as-a-portable-zip-.md) for issue #235. The boundary, name and the "done when" are Claude's; it awaits the owner's confirmation. Effort: Claude's estimate; it awaits the owner's confirmation. For issue #244, the instructions moved out of the README into the user guide, [SRC-274](SRC-274-the-readme-is-an-overview-for-users-with-detailed-.md); the deliverable is otherwise unchanged.

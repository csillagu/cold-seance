cold-seance for Windows
=======================

This folder is the whole tool. It needs a PostgreSQL database, which you install yourself.

  1. Copy config.example.yaml to config.yaml and fill it in (at least database.url and the
     GitHub settings).
  2. Run start.cmd. The tool is on http://127.0.0.1:3000. Ctrl+C stops it.
  3. Optionally, register it as a Windows service: cold-seance-service.exe install
  4. Back up the database: backup.ps1 (see its help: Get-Help .\backup.ps1 -Full).

The full instructions, including how to restrict who can read config.yaml and the key files, how
to back up and restore, and how to update, are in the user guide in this folder:
docs\user-guide\install-windows.md, also online at
https://github.com/csillagu/cold-seance/blob/main/docs/user-guide/install-windows.md

Licences: LICENSE (cold-seance, Apache License 2.0); licenses\ for Node.js and WinSW; each package
in node_modules\ holds its own; frontend\dist holds those of the frontend's bundled packages.

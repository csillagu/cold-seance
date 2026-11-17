---
certainty: verified
source: design session
evidence: design session 2026-11-16
---

# SRC-262: Backups are left to the user, helped by documentation and a backup script

Backing up the tool's database is left to the user. The user installs PostgreSQL, which comes with its dump tool. The project documents how to back up and restore, and supplies a ready-made script that takes backups on a schedule. No backup feature is built into the tool.

As received, in the design session of 2026-11-16. Asked about the Windows installation (SRC-260), the owner asked: "Would this make it possible to create backups, maybe even automatically". After Claude laid out the options, the owner asked: "How simple is it to just tell the user to take care of it? User installs the postgres and the dumper? Are there actually good tools that do the dumping?" Claude then laid out this approach: the user installs PostgreSQL, the project documents `pg_dump` and `pg_restore`, and it supplies a scheduled backup script, with no backup feature in the tool. The owner answered: "This is fine."

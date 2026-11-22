---
certainty: assumed
effort: 2
---

# SC-122: Windows backup script and backup documentation

The PowerShell backup script shipped in the Windows zip, and the Windows installation guide's backup and restore instructions ([DD-061](DD-061-the-tool-also-ships-for-windows-as-a-portable-zip-.md), [SRC-262](SRC-262-backups-are-left-to-the-user-helped-by-documentati.md)). The script dumps the tool's database with `pg_dump` into a dated file in the folder it is given, and deletes that folder's dumps older than 7 days. It takes the password from PostgreSQL's password file, not from the script or its arguments. It fails visibly, with a non-zero exit code, when the dump fails.

The instructions cover:

- registering the script to run every night at 02:00 with one scheduled-task command;
- taking a backup and restoring it by hand with `pg_dump` and `pg_restore`, or with pgAdmin's Backup and Restore dialogs;
- restoring into an empty database, and testing a restore once;
- the configuration file and the key files, which the dump does not hold and which must be backed up separately;
- how to see whether the last scheduled backup failed.

It is done when the script, run against the tool's database, leaves a new dump in the folder and removes a dump there older than 7 days, and that dump restores into an empty database that the tool then starts on.

Origin: derived by Claude from [DD-061](DD-061-the-tool-also-ships-for-windows-as-a-portable-zip-.md) and SRC-262 for issue #235. The boundary, name and the "done when" are Claude's; it awaits the owner's confirmation. Effort: Claude's estimate; it awaits the owner's confirmation. For issue #244, the instructions moved out of the README into the user guide, [SRC-274](SRC-274-the-readme-is-an-overview-for-users-with-detailed-.md); the deliverable is otherwise unchanged.

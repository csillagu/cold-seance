---
certainty: verified
source: design session
evidence: design session 2026-11-23
---

# SRC-278: The Windows guide only mentions keeping the backup folder private

The Windows installation's documentation mentions that the folder the backups are written to should be kept private, without giving a step that restricts it. A folder made at the root of a drive inherits that drive's permissions, so every user of the machine can read the dumps, which hold all of the tool's data.

As received, in the design session of 2026-11-23, recorded in issue #242. Asked "The backup folder (D:\backups\cold-seance) inherits the drive's permissions, so every local user can read the dumps, which hold all the tool's data. The guide restricts config.yaml and pgpass.conf but not the backups. Add an icacls step for the backup folder?", with the options "Yes, restrict it", "Only mention it" ("One sentence saying to keep the backup folder private") and "Leave it", the owner chose: "Only mention it".

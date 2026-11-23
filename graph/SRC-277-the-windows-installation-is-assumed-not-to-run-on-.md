---
certainty: verified
source: design session
evidence: design session 2026-11-23
---

# SRC-277: The Windows installation is assumed not to run on a laptop

The owner assumes that no one will run the tool's Windows installation on a laptop. The nightly scheduled backup that the Windows installation's documentation sets up therefore stays as it is, although Windows' defaults for such a task do not start it on battery power and skip a run missed while the machine was asleep or off.

As received, in the design session of 2026-11-23, recorded in issue #242. Asked "The guide's `schtasks /Create` makes a task that doesn't start on battery power and skips a missed 02:00 run if the machine was asleep or off (it's a laptop here). What should the guide do about it?", with the options "Add a step that fixes it", "Only warn about it" and "Leave it", the owner answered: "so we can assume that noone will be using it on a laptop haha".

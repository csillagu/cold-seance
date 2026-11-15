---
certainty: verified
source: design session
evidence: design session 2026-11-15
---

# SRC-253: A change the re-check finds is logged under whoever GitHub names for it

When the hourly re-check, rather than a webhook, finds a change made on GitHub, the audit log names whoever GitHub names for that change; where GitHub names no one, it names the change as found by the re-check.

As received, in the design session of 2026-11-15. Asked, on issue #131, "when the hourly re-check, not a webhook, finds a change on a linked issue, who should the audit log name as having made it?", with the options "Whoever GitHub names: look up who GitHub names for the change (the issue's closer, the actor of its latest reopen/status event); where GitHub names no one, log a fixed name meaning 'found by the re-check'", "Always a fixed re-check name" and "The tool's own GitHub account", the owner chose: "Whoever GitHub names".

Not stated: what the fixed name is.

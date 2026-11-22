---
certainty: verified
source: design session
evidence: design session 2026-11-22
---

# SRC-274: The README is an overview for users, with detailed user guides in a folder of their own

The README is written for the people who use the tool, not for its developers. It is an overview, and it mentions reqlite at the bottom. The details go into guides in a folder of their own, written so that anyone can read and understand them: a detailed user guide to using the MCP server, the milestones, the REST API and the UI, and a detailed guide to every installation mode, with what to look out for. Material for contributors goes into `CONTRIBUTING.md`, or is linked from there. That includes the documentation of the project's test deployment and its live GitHub tests, which SRC-264 had placed in the README. The documentation is professional and concise, but descriptive.

As received, in the design session of 2026-11-22, when the owner asked for issue #244 to be implemented:

- "We need the readme to be for the user, not for the developers."
- "Detailed user guide for using the mcp, the milestones, the rest, the ui. Detailed user guide to all installation modes, what to look out for."
- "Obviously, readme should be an overview, and guides should go to a separate folder, but I want the things to be documented so that anyone can read and understand it."
- "Conteibution related things should be added to contributing.md, or lonked from there."
- "Mention reqlite in readme (at the bottom)"
- "Professional, coincise but descriptive documentation."
- Told that the test deployment's documentation, which SRC-264 put "in the README", had been read as contributor material and moved out of the README with the rest: "Yes move those docs too from the readme"

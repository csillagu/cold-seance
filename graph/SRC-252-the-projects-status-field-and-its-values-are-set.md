---
certainty: verified
source: design session
evidence: design session 2026-11-14
---

# SRC-252: The Projects status field and its values are set in the configuration

Which GitHub Projects status field the tool reads start and hold from ([DD-015](DD-015-start-and-hold-come-from-the-github-projects-statu.md)), and which of its values mean started and on hold, are settings that can be given by environment variables when the Docker image is deployed.

As received, in the design session of 2026-11-14. Asked, on issues #116 and #122, how the tool finds "the status field the tool uses" and which of its values mean started and on hold, with the options "settings in the configuration: the field's name, `Status` by default, and the option names for started (`In Progress` by default) and on hold (`On Hold` by default), read from whichever GitHub Project the issue is in; any other value counts as not started", "a setting per registered repository in the tool" and "fixed names", the owner answered: "configurable from env variables when the docker image is deployed".

---
certainty: verified
source: design session
evidence: design session 2026-11-23
---

# SRC-279: Demo projects are seeded into the test deployment by a workflow that first deletes the live tests' projects

A GitHub workflow resets the projects of the test deployment ([DD-062](DD-062-the-test-deployment-is-a-cloud-run-service-scaled.md)) to the demo projects used for the UI/UX review of #256. It deletes the projects the live tests made, with the Neon API key, then creates the demo projects that do not exist, with planned dates relative to the day of the run, and creates no project for the `acme` repositories. The 30 demo accounts are created beforehand with very strong passwords: the seeding checks that they exist and assumes them. A demo project that already exists is left as it is, and one that does not is created again.

As received, in the design session of 2026-11-23, recorded in issue #257:

- After seeing the demo data: "this default config you have created (with all the projects) is just great. I need a workflow on github that resets the projects on the live deployment, and adds these, because these look very good. Idk, can you just create an issue about seeding good and meaningful projects into the deployment? And upload these somehow as an attachment."
- On how the reset deletes what is there: "I mean, you can use the neon apikey to do the deletion."
- In answer to the open points of the issue's first version: "Acme: then dont create these projects." "Live test: yes." "Dates: can you do now+n months instead?" "Passwords: lets create the 30 accounts beforehand with very strong passwords, and your script should assume they exist." "Re running: dont add data only. Check if the projects already exist. If so, dont do anything, besides deleting the test projects. Recreate those dont exist." "Check for users to exist."

The issue reads "Acme: then dont create these projects" as registering and requesting no `acme/*` repository while still creating the projects, and "the test projects" as the projects the live GitHub tests create; later in the same session, the owner accepted a plan built on that reading.

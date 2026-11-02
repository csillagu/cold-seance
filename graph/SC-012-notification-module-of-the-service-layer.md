# SC-012: Notification module of the service layer

The module of the service layer ([DD-039](DD-039-one-logic-layer-for-ui-rest-api-and-mcp-server.md)) that creates in-app notifications only ([DD-003](DD-003-notifications-are-in-app-only.md)), keeps people's subscriptions to issues and projects, and sends each subscriber the notifications for what they subscribed to. It offers no cross-project change-request flow ([DD-012](DD-012-no-cross-project-change-request-flow-in-v1.md)).

It delivers:

- [FR-082](FR-082-deliver-notifications-in-the-app-only.md): Deliver notifications in the app only
- [FR-083](FR-083-notify-of-each-new-red-flag.md): Notify of each new red flag
- [FR-084](FR-084-notify-both-owners-when-a-shared-milestone-moves-p.md): Notify both owners when a shared milestone moves past a dependent task's start
- [FR-085](FR-085-notify-reviewers-of-a-proposal-waiting-for-review.md): Notify reviewers of a proposal waiting for review
- [FR-086](FR-086-notify-of-each-change-reverted-on-github.md): Notify of each change reverted on GitHub
- [FR-133](FR-133-let-people-subscribe-to-issues-and-projects.md): Let people subscribe to issues and projects
- [FR-134](FR-134-subscribe-read-write-and-admin-members-to-their-pr.md): Subscribe read-write and admin members to their projects automatically
- [FR-155](FR-155-offer-no-cross-project-change-request-flow.md): Offer no cross-project change-request flow
- [FR-162](FR-162-send-subscribers-the-notifications-for-what-they-s.md): Send subscribers the notifications for what they subscribed to
- [FR-173](FR-173-notify-a-repository-s-admins-in-the-app-of-a-proje.md): Notify a repository's admins in the app of a project's request

Origin: derived by Claude from the linked FRs and DDs, at the owner's request ("Derive the solution components from the existing frs and dds", 2026-11-02), for issue #11. The component's boundary and name are Claude's; it awaits the owner's confirmation. Effort: not stated; it awaits the owner's estimate.

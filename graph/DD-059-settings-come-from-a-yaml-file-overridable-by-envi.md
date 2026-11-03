---
certainty: verified
---

# DD-059: Settings come from a YAML file, overridable by environment variables

## Decision

The tool reads its settings at start from one YAML configuration file ([SRC-210](SRC-210-secrets-are-given-in-configuration-not-typed-in.md), [SRC-212](SRC-212-settings-such-as-the-re-check-interval-are-given.md)). Any setting in the file can be overridden by an environment variable, so a Docker Compose file ([DD-040](DD-040-the-tool-ships-as-one-application-image-run-with-p.md)) can set it without a file. Settings are not typed into the tool by an admin, and the tool does not store them in its database.

The settings named so far are:

- the PostgreSQL database's address ([FR-177](FR-177-use-the-postgresql-database-given-in-the-configura.md)), with a direct connection for migrations ([DD-057](DD-057-the-schema-and-its-migrations-are-managed-with-dri.md));
- for each GitHub function, the App's id, its private key and, if it sends webhooks, its webhook secret (DD-058);
- the interval of the re-check of linked issues ([SRC-212](SRC-212-settings-such-as-the-re-check-interval-are-given.md)), one hour unless set otherwise ([SRC-213](SRC-213-the-re-check-interval-is-one-hour-by-default.md));
- the address and the port the backend listens on, this machine only (`127.0.0.1`) and port 3000 unless set otherwise; the application image ([DD-040](DD-040-the-tool-ships-as-one-application-image-run-with-p.md)) sets the address to every interface of its container, so that its published port reaches the backend.

The private key is given as the path of its key file, which Docker mounts into the container, rather than as the key itself: a key file runs over many lines, which a YAML value or an environment variable carries badly. The tool refuses to start if a required setting is missing or a key file cannot be read, and names the setting.

Which other settings belong here is not stated.

## Alternatives considered

- Typing the settings into a page in the tool and storing them in the database, which the owner rejected for secrets.
- Environment variables only, with no file.
- A YAML file only, with no environment variables.
- For the listen address: a setting, as chosen; the image alone listening on every interface, by a start argument that is not a setting; or listening on every interface everywhere.

## Rationale

The owner proposed configuration over typing secrets into the tool ([SRC-210](SRC-210-secrets-are-given-in-configuration-not-typed-in.md)), and Claude agrees. Secrets stay out of the database and its backups, where DD-053 had put them. A file and environment variables are how a Docker Compose installation is normally set up, and they can be kept and versioned beside the Compose file. A file holds the longer, structured settings, such as one App per function, more readably than environment variables; environment variables let a hosted or scripted installation set a value without editing the file. A listen address that is a setting lets the image be reached through its published port while a backend started outside it stays on its own machine, and it is changed the same way as every other setting.

## Trade-offs

- Changing a setting means editing the file or the environment and restarting the tool; nothing can be changed from the tool's own pages.
- Two more settings to document, for a value most installations leave as the image sets it.
- Two places for one setting: the environment variable wins, which must be documented so that an edit to the file that seems to have no effect can be explained.

## Risks

- A configuration file or a key file readable by other users of the host gives away the secrets. The install instructions must say how to restrict them.
- A re-check interval set longer than an hour exceeds the worst-case delay the owner accepted ([SRC-191](SRC-191-an-hour-is-an-acceptable-delay-for-github-sync-and.md)).
- A typo in a setting's name is silently ignored unless the tool rejects settings it does not know.
- A listen address set to every interface outside a container exposes the backend to the whole network the host is on.

## Serves

This decision serves [SRC-210](SRC-210-secrets-are-given-in-configuration-not-typed-in.md), [SRC-212](SRC-212-settings-such-as-the-re-check-interval-are-given.md), [SRC-213](SRC-213-the-re-check-interval-is-one-hour-by-default.md), [SRC-191](SRC-191-an-hour-is-an-acceptable-delay-for-github-sync-and.md), [SRC-199](SRC-199-people-can-install-the-tool-simply.md), [DD-040](DD-040-the-tool-ships-as-one-application-image-run-with-p.md), [FR-177](FR-177-use-the-postgresql-database-given-in-the-configura.md), [DD-057](DD-057-the-schema-and-its-migrations-are-managed-with-dri.md).

Origin: the owner proposed configuration in a YAML file or environment variables in the design session of 2026-11-03 and asked for Claude's view (SRC-210). This DD is Claude's answer: the file with environment variables overriding it, private keys as key files, and refusing to start on a missing setting are Claude's. The wording, alternatives, rationale, trade-offs and risks are Claude's. The owner confirmed it in the same session: "config confirmed". The default interval of one hour (SRC-213) and the risk of a longer interval were added afterwards, from the owner's answer in that session. The listen address and port were added while the application image was built (SC-028, issue #31): in the design session of 2026-11-03, asked how the image's backend should be reached, the owner chose "New settings server.host/port" over the two other options above, and asked for it to be recorded in this DD: "Go with a". Their wording, rationale, trade-off and risk are Claude's and await the owner's confirmation.

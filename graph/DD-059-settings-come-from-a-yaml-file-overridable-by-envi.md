# DD-059: Settings come from a YAML file, overridable by environment variables

## Decision

The tool reads its settings at start from one YAML configuration file ([SRC-210](SRC-210-settings-and-secrets-are-given-in-configuration-n.md)). Any setting in the file can be overridden by an environment variable, so a Docker Compose file ([DD-040](DD-040-the-tool-ships-as-one-application-image-run-with-p.md)) can set it without a file. Settings are not typed into the tool by an admin, and the tool does not store them in its database.

The settings named so far are:

- the PostgreSQL database's address ([FR-177](FR-177-use-the-postgresql-database-given-in-the-configura.md)), with a direct connection for migrations ([DD-057](DD-057-the-schema-and-its-migrations-are-managed-with-dri.md));
- for each GitHub function, the App's id, its private key and, if it sends webhooks, its webhook secret (DD-058);
- the interval of the re-check of linked issues ([SRC-210](SRC-210-settings-and-secrets-are-given-in-configuration-n.md)).

The private key is given as the path of its key file, which Docker mounts into the container, rather than as the key itself: a key file runs over many lines, which a YAML value or an environment variable carries badly. The tool refuses to start if a required setting is missing or a key file cannot be read, and names the setting.

Which other settings belong here is not stated. The default re-check interval is not stated; one hour is the interval of [SRC-073](SRC-073-hourly-reconciliation-of-all-linked-issues.md).

## Alternatives considered

- Typing the settings into a page in the tool and storing them in the database, which the owner rejected for secrets.
- Environment variables only, with no file.
- A YAML file only, with no environment variables.

## Rationale

The owner proposed configuration over typing secrets into the tool ([SRC-210](SRC-210-settings-and-secrets-are-given-in-configuration-n.md)), and Claude agrees. Secrets stay out of the database and its backups, where DD-053 had put them. A file and environment variables are how a Docker Compose installation is normally set up, and they can be kept and versioned beside the Compose file. A file holds the longer, structured settings, such as one App per function, more readably than environment variables; environment variables let a hosted or scripted installation set a value without editing the file.

## Trade-offs

- Changing a setting means editing the file or the environment and restarting the tool; nothing can be changed from the tool's own pages.
- Two places for one setting: the environment variable wins, which must be documented so that an edit to the file that seems to have no effect can be explained.

## Risks

- A configuration file or a key file readable by other users of the host gives away the secrets. The install instructions must say how to restrict them.
- A typo in a setting's name is silently ignored unless the tool rejects settings it does not know.

## Serves

This decision serves [SRC-210](SRC-210-settings-and-secrets-are-given-in-configuration-n.md), [SRC-199](SRC-199-people-can-install-the-tool-simply.md), [DD-040](DD-040-the-tool-ships-as-one-application-image-run-with-p.md), [FR-177](FR-177-use-the-postgresql-database-given-in-the-configura.md), [DD-057](DD-057-the-schema-and-its-migrations-are-managed-with-dri.md).

Origin: the owner proposed configuration in a YAML file or environment variables in the design session of 2026-11-03 and asked for Claude's view (SRC-210). This DD is Claude's answer: the file with environment variables overriding it, private keys as key files, and refusing to start on a missing setting are Claude's. The wording, alternatives, rationale, trade-offs and risks are Claude's, and they await the owner's confirmation.

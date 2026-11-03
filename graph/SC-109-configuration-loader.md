---
certainty: assumed
effort: 2
---

# SC-109: Configuration loader

The backend module that, at start, reads the YAML configuration file, applies the environment variables that override it, reads the GitHub Apps' key files, and hands the result to the rest of the backend ([DD-059](DD-059-settings-come-from-a-yaml-file-overridable-by-envi.md)). It refuses to start, naming the setting, if a required setting is missing or a key file cannot be read. It is done when every setting named in the decision can be given in the file or by an environment variable, the environment variable wins over the file, and a missing required setting stops the start with a message naming it.

It delivers:

- [FR-177](FR-177-use-the-postgresql-database-given-in-the-configura.md): Use the PostgreSQL database given in the configuration

Origin: added by Claude for issue #11, after the owner proposed configuration over typing secrets into the tool in the design session of 2026-11-03 (SRC-210). The boundary and name are Claude's; it awaits the owner's confirmation. Effort: Claude's estimate. The owner confirmed it in the design session of 2026-11-03: "Efforts ok".

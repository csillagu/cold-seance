# TC-259: The tool stores its data in the PostgreSQL database given in its configuration

Verifies [FR-177](FR-177-use-the-postgresql-database-given-in-the-configura.md).

## Intent

Verify that the system uses the PostgreSQL database whose address is given in its configuration, including an external hosted service, instead of the one it is installed with.

## Inputs

- An empty database `X` on an external hosted PostgreSQL service, such as Neon, and its address.
- Install `I1` of the tool, configured with `X`'s address, with the database it is installed with stopped.
- A second install `I2` on another machine, configured with the same address.

## Procedure

1. Start `I1`; as the first system admin, create project `Persisted`. Stop `I1`.
2. Start `I2` and list the projects as the same system admin.

## Expected response

- `I1` starts and works while the database it was installed with is stopped.
- `I2` lists `Persisted`.

## Negative assertions

- `I1` does not refuse to start or fail at step 1 because its own database is unavailable.

## Cleanup

Stop `I2` and delete database `X`.

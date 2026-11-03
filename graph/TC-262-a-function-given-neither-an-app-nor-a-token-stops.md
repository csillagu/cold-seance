# TC-262: A function given neither an App nor a token stops the start

Verifies [FR-187](FR-187-refuse-to-start-when-a-github-function-is-given-ne.md).

## Intent

Verify that the system does not start when its configuration gives a GitHub function neither an App nor a personal access token, and names that function.

## Inputs

- A test configuration with a reachable empty PostgreSQL database, that gives reading issues and the Projects status field the test GitHub App `tc-app`, and gives writing to issues neither an App nor a token.

## Procedure

1. Start the tool with that configuration.
2. Read its output, and try to reach its REST API on its configured port.

## Expected response

- The tool stops, and its output names writing to issues as given neither an App nor a token.

## Negative assertions

- The REST API does not answer on the configured port.

## Cleanup

Discard the test database.

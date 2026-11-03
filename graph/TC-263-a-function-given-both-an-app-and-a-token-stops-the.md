# TC-263: A function given both an App and a token stops the start

Verifies [FR-187](FR-187-refuse-to-start-when-a-github-function-is-given-ne.md).

## Intent

Verify that the system does not start when its configuration gives a GitHub function both an App and a personal access token, and names that function.

## Inputs

- A test configuration with a reachable empty PostgreSQL database, that gives every GitHub function the test GitHub App `tc-app`, and also gives writing to issues a personal access token of GitHub account `tc-bot`.

## Procedure

1. Start the tool with that configuration.
2. Read its output, and try to reach its REST API on its configured port.

## Expected response

- The tool stops, and its output names writing to issues as given both an App and a token.

## Negative assertions

- The REST API does not answer on the configured port.

## Cleanup

Discard the test database.

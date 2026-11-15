# Packaged and hosted runtime contract

`npm run test:package` runs the existing clean-consumer smoke against an `npm pack` artifact. It checks the MCP initialize response, exact package version, complete package tool-name catalog, and two structured validation failures over the installed executable's real stdio protocol boundary. It also runs an intentional version-mismatch control and fails if the comparator accepts it.

To run those same safe protocol cases against an authorized local, staging, or preview Streamable HTTP MCP endpoint, set:

```sh
MCP_CONTRACT_HOST_URL=https://<authorized-host>/api/mcp \
MCP_CONTRACT_HOST_ENV=staging \
MCP_CONTRACT_HOST_REVISION=<deployed-host-git-sha> \
MCP_CONTRACT_HOST_TOKEN=<scoped-test-org-token> \
MCP_CONTRACT_REPORT=./runtime-contract-report.json \
npm run test:package
```

`MCP_CONTRACT_HOST_ENV` must be `local`, `staging`, or `preview`. The production `mcp.vapi.ai` hostname is rejected. HTTP is accepted only for loopback. Supply the deployed host revision from the deployment record; the current hosted protocol does not expose a build SHA, so the report labels this revision as operator-supplied. Do not put credentials in the endpoint URL. The bearer token is passed only to the selected endpoint and never written to the report.

The hosted check initializes the server, lists tools, and submits only malformed arguments to `get_tool` and `create_simulation_personality`. These requests fail input validation before any Vapi API operation; the check does not create or modify customer resources, place calls, or run simulations. The package-side smoke uses a dummy token and performs the same validation-only requests.

The hosted catalog must contain every packaged tool name. Additional host-only tools are recorded separately because the hosted wrapper may add capabilities such as feedback. Both targets must return `INVALID_ARGUMENTS` with the expected field path for the invalid calls. This is a safe baseline contract; cases for execution failures, read-only policy, cancellation/deadlines, and retry behavior remain pending their owning PAL tickets.

The JSON report includes package version and source SHA, the supplied host SHA and reported MCP server info, a fingerprint of the protocol/case/catalog contract, per-target case counts, and separate `merged`, `published`, and `deployed` lifecycle fields. Without a host URL, hosted status remains `pending`; a pending target is not counted as a pass. Save the report with the PR or attach it to PAL-1336. The default runner prints the report to stdout; `MCP_CONTRACT_REPORT` retains a local copy, so choose and apply the team's normal retention policy when sharing it.

This command remains an opt-in/manual check. It is not a new required CI gate, publishing step, production monitor, or scheduled run.

The hosted server does not currently expose a verifiable package or contract identity. Therefore a successful behavioral probe remains **pending**, even when all four cases pass. The operator-supplied host SHA is context, not proof. A stale-version control records this limitation; the local contract fingerprint identifies the checker only. Execution error, result completeness, read-only denial, cancellation/deadline, and retry safety cases are explicitly pending for both targets. HTTP requests, including SSE reads, have a 10-second deadline and redirects are rejected. External staging verification remains pending.

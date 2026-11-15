# MCPJam behavioral evaluations

This suite evaluates how a model uses Vapi's complete MCP tool catalog. It starts the production `registerAllTools` registrations over MCP stdio, connects a pinned MCPJam SDK `HostRunner`, and directs the Vapi SDK to an in-memory HTTP fixture. The fixture only binds to loopback and the stdio server refuses any non-loopback fixture URL. Calls, writes, and simulation runs in this suite cannot reach Vapi production or place a real phone call.

The development and held-out task prompts describe outcomes without naming tools or prescribing a tool sequence. Scoring checks the fixture's final state, relevant/forbidden calls, tool arguments, validation responses, and final response. It permits optional skill or documentation retrieval and does not require them. The full catalog remains visible to each run. MCPJam traces are saved for review with each trial.

The dataset covers creating and updating an assistant, creating and attaching a callable tool, updating an existing tool, one explicitly authorized scheduled call and progress check, using simulations instead of calling for testing, building and running a simulation suite, recovering from invalid arguments, responding to feedback without redialing, asking for a missing destination, and accurately reporting that `get_call` currently omits transcript and recording fields. The latter is scored as a product capability gap, not an agent failure. The harness does not add missing product capabilities.

## Reproduce a comparison

Install the lockfile dependencies and build as usual. Live model work runs only when explicitly invoked; ordinary `npm test` does not read model-provider credentials.

1. Set a supported model and its provider credential using the team's approved secret mount or the shell's secret environment. For example, `MCPJAM_MODEL=openai/gpt-4o-mini` requires `OPENAI_API_KEY`. The default model is `openai/gpt-4o-mini`; the report records the variable name, never its value.
2. Run the small pilot: `npm run eval:mcpjam -- --phase pilot`. The pilot uses two independent trials per task and catalog.
3. Review `artifacts/mcpjam/<run-id>/manifest.json` and the adjacent trace files. The manifest records the dataset/scorer versions and hashes, catalog refs and hashes, model/sampling settings, denominators, failures, inconclusive runs, tokens, latency, and cost availability. The pilot recommends a per-task trial count from the observed Bernoulli variability for an approximate 95% interval half-width of 20 percentage points, with five independent trials as a minimum. This estimates effort; it is not a score threshold.
4. Run the comparison at that count, for example `npm run eval:mcpjam -- --phase compare --trials 8`. A comparison requires at least two trials per task/catalog. The default frozen catalog refs are main `c0a0c0fc0c72a826ff5403f510a2e8d4b6cece45` and PR #62 `0e17ed47a2bb44c3cae18e7355d7c3ab42d5135d`. Override them with `MCPJAM_BASELINE_REVISION` and `MCPJAM_CANDIDATE_REVISION` only when recording the changed refs.

Each independent trial starts a fresh fixture and MCP server. Condition order alternates to reduce timing bias. The report preserves errors as inconclusive rather than converting them into passes. The MCPJam SDK reports input/output/total tokens and latency; its `PromptResult` has no monetary cost field, so cost is honestly recorded as unavailable. There is no quality score gate. The readout compares outcome rates with denominators and uncertainty and may conclude that the evidence is inconclusive.

## Frozen data and artifacts

The task set and scorer are versioned in `src/evals/scenarios.ts` and `src/evals/scorer.ts`. The base catalog is the actual main registration at the frozen main revision. The candidate uses the ten description values from PR #62 with the same production registrations, input schemas, annotations, validation, and transformers. Full effective catalog hashes are captured from MCP `tools/list` for both conditions on each run.

Raw model traces and manifests are written to the ignored `artifacts/mcpjam/` directory. Keep the full run artifact for 90 days in the CI artifact store or attach it to PAL-1328; preserve the concise accepted comparison summary and frozen manifest in Linear and, after review, under `evaluation/results/` in version control. No model-backed CI check runs by default, and this change does not add a required merge gate.

If the provider credential is unavailable, the command writes a `blocked` manifest naming the exact missing environment variable and records zero model trials. A missing credential, provider error, or unrun comparison is not a pass.

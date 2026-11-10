# Vapi MCP Server

Build AI voice assistants and phone agents with [Vapi](https://vapi.ai) from any agent or app that speaks the [Model Context Protocol](https://modelcontextprotocol.com/).

## Connect to the hosted server

**You don't need to clone, install or run anything.** Vapi hosts this server for you:

- **URL:** `https://mcp.vapi.ai/mcp` (Streamable HTTP)
- **Header:** `Authorization: Bearer YOUR_VAPI_API_KEY`

Get an API key from the [Vapi dashboard](https://dashboard.vapi.ai/org/api-keys).

👉 **[Step-by-step setup for Codex, Claude Code, Cursor, VS Code, Hermes and Claude Desktop](https://docs.vapi.ai/sdk/mcp-server#connect-your-agent)**

The two most common setups:

**Claude Code**

```bash
export VAPI_API_KEY="YOUR_VAPI_API_KEY"
claude mcp add --transport http --scope user vapi \
  https://mcp.vapi.ai/mcp \
  --header 'Authorization: Bearer ${VAPI_API_KEY}'
```

**Codex**

```bash
export VAPI_API_KEY="YOUR_VAPI_API_KEY"
codex mcp add vapi --url https://mcp.vapi.ai/mcp \
  --bearer-token-env-var VAPI_API_KEY
```

Keep `VAPI_API_KEY` set whenever you launch your agent. Start a new session, then try:

```
List my Vapi assistants.
```

```
I want to build a voice assistant that can schedule appointments.
```

```
Call +1234567890 using my appointment reminder assistant with these details:
- Customer name: Sarah Johnson
- Appointment date: March 25th
- Appointment time: 2:30 PM
```

```
Schedule a call with my support assistant for next Tuesday at 3:00 PM to +1555123456
```

> The legacy SSE endpoint (`https://mcp.vapi.ai/sse`) is deprecated. Move existing remote configurations to `https://mcp.vapi.ai/mcp`.

### Optional: add the Vapi agent skill

The [`skill`](./skill) directory contains reusable instructions for AI coding agents that support Agent Skills. Install it using your host's skill installation process.

For Claude Code:

```bash
mkdir -p ~/.claude/skills/vapi
curl -o ~/.claude/skills/vapi/SKILL.md https://raw.githubusercontent.com/VapiAI/mcp-server/main/skill/SKILL.md
```

### Using Variable Values in Assistant Prompts

The `create_call` action supports passing dynamic variables through `assistantOverrides.variableValues`. Use double curly braces in your assistant's prompts: `{{variableName}}`.

#### Example Prompt with Variables

```
Hello {{customerName}}, this is a reminder about your appointment on {{appointmentDate}} at {{appointmentTime}} with {{doctorName}}.
```

#### Default Variables

These are automatically available (no need to pass):

- `{{now}}` - Current date and time (UTC)
- `{{date}}` - Current date (UTC)
- `{{time}}` - Current time (UTC)
- `{{month}}` - Current month (UTC)
- `{{day}}` - Current day of month (UTC)
- `{{year}}` - Current year (UTC)
- `{{customer.number}}` - Customer's phone number

See [Vapi documentation](https://docs.vapi.ai/assistants/dynamic-variables#default-variables) for advanced date/time formatting.

---

## Oh, you're still here?

You must want to [leave feedback](#leave-feedback), [run a local server yourself](#run-a-local-server) or [peek under the hood](#peek-under-the-hood). Read on.

### Leave feedback

- **Found a bug or want a tool we don't have?** [Open an issue](https://github.com/VapiAI/mcp-server/issues).
- **Have a question or want to talk it through?** Join the [Vapi Discord](https://discord.gg/v5Ee6FhAZt).
- **Want to fix it yourself?** Pull requests are welcome. See [Development](#development) for how to build and test.

### Run a local server

Run the server on your own machine if your client only supports local stdio servers or you want to try unreleased changes. It uses the same tools as the hosted server.

Configure your MCP client to run:

```text
npx -y @vapi-ai/mcp-server
```

Set `VAPI_TOKEN` to your Vapi API key in the server environment. MCP client configuration formats vary, but the server definition generally looks like this:

```json
{
  "mcpServers": {
    "vapi": {
      "command": "npx",
      "args": ["-y", "@vapi-ai/mcp-server"],
      "env": {
        "VAPI_TOKEN": "<your_vapi_token>"
      }
    }
  }
}
```

For Claude Code:

```bash
claude mcp add -e VAPI_TOKEN=your_vapi_token vapi -- npx -y @vapi-ai/mcp-server
```

For Claude Desktop, add the configuration above to the Claude Desktop configuration file.

To run a build from this repository instead, see [Local Development Config](#local-development-config).

---

## Peek under the hood

### Available Tools

#### Documentation
| Tool | Description |
|------|-------------|
| `ask_vapi_docs` | Query the Fern docs MCP for current documentation passages and source URLs |

`ask_vapi_docs({"question":"How do assistant hooks work?","topK":8})` forwards to
`searchDocs` at `https://docs.vapi.ai/_mcp/server`. The result preserves Fern's
content, source links and error flag. This endpoint currently returns passages
for the calling agent to synthesize, rather than a generated answer. `topK`
defaults to 8 (maximum 20). Each request owns its MCP connection, supports caller
cancellation, times out after 30 seconds and closes the connection afterwards.

This tool needs outbound HTTPS to the Fern endpoint. It makes no Vapi API calls
and sends no Vapi credentials upstream. The server still requires `VAPI_TOKEN`
at startup. Discovery through `tools/list` makes no network requests; upstream
failures are returned as tool errors. No extra MCP connection is needed. Do not
include secrets or private customer data in docs questions.

#### Assistants
| Tool | Description |
|------|-------------|
| `list_assistants` | List assistants in pages of up to 10 |
| `get_assistant` | Get assistant by ID |
| `create_assistant` | Create new assistant |
| `update_assistant` | Update assistant |

#### Calls
| Tool | Description |
|------|-------------|
| `list_calls` | List call history in pages of up to 10 |
| `get_call` | Get call details |
| `create_call` | Start outbound call (immediate or scheduled) |

#### Phone Numbers
| Tool | Description |
|------|-------------|
| `list_phone_numbers` | List phone numbers in pages of up to 10 |
| `get_phone_number` | Get phone number details |

#### Tools (Function Calling)
| Tool | Description |
|------|-------------|
| `list_tools` | List custom tools in pages of up to 10 |
| `get_tool` | Get tool details |
| `create_tool` | Create tool for API integration |
| `update_tool` | Update tool |

#### Public Skills
| Tool | Description |
|------|-------------|
| `search_skills` | Search public Vapi skills by keywords; omit `query` to browse |
| `load_skill` | Read a skill's `SKILL.md` or a supporting file |

For example, call `search_skills({"query":"simulations"})`, then
`load_skill({"name":"simulations"})`. The load result includes a `files` list;
read a supporting file with `load_skill({"name":"simulations","path":"references/example.md"})`,
using an exact path from that list. Loading returns instructions for the current
task; it does not install skills or run scripts.

Skills come directly from the public [VapiAI/skills](https://github.com/VapiAI/skills)
repository, including experimental skills. Discovery uses its GitHub tree rather
than the proposed skills manifest. Each server caches a commit-pinned snapshot
for five minutes, so file reads within that snapshot use the same revision. Search
matches names, descriptions and instruction text; it returns at most `limit`
results (default 10, maximum 30) and the total match count. `load_skill` returns
one text file at a time, up to 512 KB, with its source URL and revision.

The skills tools need outbound HTTPS to public GitHub. They make no Vapi API
calls and send no Vapi credentials upstream. The server still requires
`VAPI_TOKEN` at startup. Discovery through `tools/list` makes no network requests;
upstream failures are returned as tool errors. No GitHub token is needed for this
public content. GitHub's unauthenticated API rate limits apply.

#### Simulations

| Tool | Description |
|------|-------------|
| `list_simulation_personalities` | List simulated callers |
| `create_simulation_personality` | Create a simulated caller with a tester assistant |
| `list_simulation_scenarios` | List tester scripts and evaluations |
| `create_simulation_scenario` | Create a tester script and evaluations |
| `list_simulations` | List scenario/personality pairs |
| `create_simulation` | Pair a scenario with a personality |
| `list_simulation_suites` | List groups of simulations |
| `create_simulation_suite` | Group simulations into a suite |
| `run_simulations` | Run simulations or suites against an assistant or squad |
| `list_simulation_runs` | List runs and filter by status or target |
| `get_simulation_run` | Get run status and item summaries |
| `get_simulation_run_item` | Get a full item including transcript and results |

The catalog contains 29 tools. Simulation lists default to 50 results.
`get_simulation_run` returns the first 100 item summaries, with API pagination
metadata in `itemsMetadata` and `itemsTruncated: true` when more items exist.
Legacy array responses are also supported. Use `get_simulation_run_item` for
the full details of a known item.

### Development

```bash
# Install dependencies
npm install

# Build
npm run build

# Test with MCP inspector
npm run inspector
```

#### Local Development Config

```json
{
  "mcpServers": {
    "vapi-local": {
      "command": "node",
      "args": ["<path>/dist/index.js"],
      "env": {
        "VAPI_TOKEN": "<your_vapi_token>"
      }
    }
  }
}
```

#### Testing

```bash
# Safe default suite (build, mocked execution, contract, and stdio compatibility)
npm test

# Unit tests (mocked public tool execution and catalog contract)
npm run test:unit

# Documentation/tool-catalog consistency lint
npm run test:docs

# Full TypeScript check (production and test code)
npm run typecheck

# Build and run local stdio protocol compatibility tests (no Vapi API calls)
npm run test:stdio

# Pack, install, and launch the package from a clean temporary consumer
npm run test:package

# Live read-only API tests
export VAPI_TOKEN=your_token_here
npm run test:live:readonly

# Live mutating tests (creates and cleans up disposable assistants and tools)
export VAPI_TOKEN=your_test_org_token_here
npm run test:live:mutating
```

#### Input validation from OpenAPI

All 21 parameterized MCP tools use imported OpenAPI constraints through
Zod's experimental `z.fromJSONSchema()`, pinned to Zod 4.6.7. This covers
assistant names/LLMs/voices/transcribers, call schedules and customer numbers,
lookup/update IDs, function parameters, transfer destinations, HTTP methods,
timeouts and retry plans, plus all 12 simulation tools. The four original list
tools have local empty input schemas.

`src/schemas/assistant-openapi.json` is the compact projection for the original
tool surfaces (the filename is retained from the initial assistant cutover). It
records the [public API spec](https://api.vapi.ai/api-json) source SHA-256 and
includes the recursive JSON-schema definitions needed for function parameters
and request bodies. Builds and installs use it without network access. Refresh
explicitly with `npm run schemas:snapshot`, or pass a saved spec with
`npm run schemas:snapshot -- /path/spec.json`.

`src/schemas/simulation-openapi.json` bundles the full simulation DTOs and their
referenced definitions from the same public spec. The same refresh command
updates both snapshots. Simulation validation includes names, folder paths,
UUIDs, instructions, evaluations, nested tester assistants and structured
outputs. Scenario/suite `additionalFields` are validated after merging, so they
cannot override an API constraint. Large nested assistant and structured-output
objects have compact advertised envelopes; their full API contracts are checked
at runtime. The shared summary projection omits long documentation and recursive
definitions from simulation discovery. The 25-tool catalog is about 28 KB.
No runtime schema fetch or
`get_api_schema` tool is required.

Simulation aliases remain local adapters: `run_simulations` takes exactly one
assistant/squad target and at least one simulation/suite ID, then builds the API
request. Integer iterations and integer page sizes of 1–100 are MCP policies;
API iteration bounds and parameter formats come from the snapshot. The item
lookup endpoint publishes plain strings for its IDs, so those are not assigned
UUID constraints from a different endpoint.

The shared normalizer also represents empty preset enums as always-failing
branches and preserves property names such as `oneOf` and `default` when walking
JSON Schema definitions.

When upgrading `@vapi-ai/server-sdk`, refresh and review the bundled schema in
the same PR, then run `npm run typecheck`, `npm test`, and `npm run test:package`.
Check changes against the SDK's request types and the MCP adapters below. The
public endpoint serves the current API spec, not a spec version tied to the SDK
release, so refreshing does not by itself guarantee compatibility. Keep the
reviewed schema bundled with the release; do not refresh it during installation
or startup.

The adapter documents published contract corrections: overlapping enum/string
`oneOf` alternatives become `anyOf`; duplicate enum values and JavaScript regex
delimiters are removed; the contradictory object/string-enum annotation on
`BackoffPlan.type` is corrected. Provider variants reject undeclared fields.
Spec defaults do not inject request fields; MCP defaults remain separate.
For the original compact assistant tools, variants requiring fields outside
the current interface remain excluded: custom
voice, Neuphonic voice, custom transcriber, Speechmatics transcriber, and custom
LLM. Adding their required fields needs an explicit interface extension.

MCP wrappers preserve field aliases and sparse updates. URL checks and
string-valued header maps remain explicit transport rules because the spec only
describes a string/object. API-request header maps and SMS metadata retain legacy MCP representations;
they are explicit compatibility adapters, not claimed to be full API DTO
validation. SMS metadata is not described in the published DTO. Response summaries also remain
local: they are transformed MCP representations, not raw API DTOs.

Validation failures return `isError: true`, concise text and structured
`validationError` details: tool name, issue code, field path, message and allowed
choices where relevant. Errors select the supplied provider's union branch,
include at most 12 issues and 8 allowed choices per issue, and indicate
truncation. Submitted values and credential contents are not echoed. Agents
should correct the listed fields and retry; a validation failure never invokes
the API handler. Tests exercise this correction loop through a real MCP client.

`tools/list` advertises a compact input summary derived from the same validators:
field names, basic types, required fields, defaults, and short constraints. It
omits provider/model catalogs, lengthy API documentation, and recursive schema
definitions. The full OpenAPI-derived validator still runs before any API call;
the advertised summary is intentionally broader. Catalog tests cap the
original 13-tool list at 20 KB, the 12 simulation tools at 10 KB, and the complete
25-tool list at 30 KB to prevent unexpected agent-context growth.

`npm test` includes schema contract tests, independent Ajv parity cases, and
validation-feedback tests. The existing live compatibility
suites cover read-only resources and disposable assistants/custom tools.

---

## References

- [Vapi Documentation](https://docs.vapi.ai)
- [Vapi Dashboard](https://dashboard.vapi.ai)
- [Vapi Remote MCP Server](https://mcp.vapi.ai/)
- [Model Context Protocol](https://modelcontextprotocol.com/)

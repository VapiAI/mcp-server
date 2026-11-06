# Vapi MCP Server

Build AI voice assistants and phone agents with [Vapi](https://vapi.ai) using the [Model Context Protocol](https://modelcontextprotocol.com/).

## Setup

The MCP server requires a Vapi API key. Get one from the [Vapi dashboard](https://dashboard.vapi.ai/org/api-keys).

### Local Server (stdio)

Configure any MCP client that supports local stdio servers to run:

```text
npx -y @vapi-ai/mcp-server
```

Set `VAPI_TOKEN` in the server environment. MCP client configuration formats vary, but the server definition generally looks like this:

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

### Remote Server (Streamable HTTP)

Clients that support remote MCP servers can connect directly:

- URL: `https://mcp.vapi.ai/mcp`
- Header: `Authorization: Bearer your_vapi_api_key_here`

### Client-Specific Examples

#### Claude Code

```bash
claude mcp add -e VAPI_TOKEN=your_vapi_token vapi -- npx -y @vapi-ai/mcp-server
```

#### Claude Desktop

Use the local server configuration above in the Claude Desktop configuration file. To connect to the hosted server through an stdio bridge instead:

```json
{
  "mcpServers": {
    "vapi": {
      "command": "npx",
      "args": [
        "mcp-remote",
        "https://mcp.vapi.ai/mcp",
        "--header",
        "Authorization: Bearer ${VAPI_TOKEN}"
      ],
      "env": {
        "VAPI_TOKEN": "<your_vapi_token>"
      }
    }
  }
}
```

### Optional Agent Skill

The [`skill`](./skill) directory contains reusable instructions for AI coding agents that support Agent Skills. Install it using your host's skill installation process.

For Claude Code:

```bash
mkdir -p ~/.claude/skills/vapi
curl -o ~/.claude/skills/vapi/SKILL.md https://raw.githubusercontent.com/VapiAI/mcp-server/main/skill/SKILL.md
```

---

## Example Usage

### Create a Voice Assistant

Ask your MCP-enabled agent:
```
I want to build a voice assistant that can schedule appointments
```

### Make an Outbound Call

```
Call +1234567890 using my appointment reminder assistant with these details:
- Customer name: Sarah Johnson
- Appointment date: March 25th
- Appointment time: 2:30 PM
```

### Schedule a Future Call

```
Schedule a call with my support assistant for next Tuesday at 3:00 PM to +1555123456
```

---

## Using Variable Values in Assistant Prompts

The `create_call` action supports passing dynamic variables through `assistantOverrides.variableValues`. Use double curly braces in your assistant's prompts: `{{variableName}}`.

### Example Prompt with Variables

```
Hello {{customerName}}, this is a reminder about your appointment on {{appointmentDate}} at {{appointmentTime}} with {{doctorName}}.
```

### Default Variables

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

## Remote MCP Server

Connect to Vapi's hosted MCP server from any MCP client:

### Streamable HTTP (Recommended)

- URL: `https://mcp.vapi.ai/mcp`
- Header: `Authorization: Bearer your_vapi_api_key_here`

### SSE (Deprecated)

- URL: `https://mcp.vapi.ai/sse`
- Header: `Authorization: Bearer your_vapi_api_key_here`

---

## Available Tools

### Assistants
| Tool | Description |
|------|-------------|
| `list_assistants` | List all assistants |
| `get_assistant` | Get assistant by ID |
| `create_assistant` | Create new assistant |
| `update_assistant` | Update assistant |

### Calls
| Tool | Description |
|------|-------------|
| `list_calls` | List call history |
| `get_call` | Get call details |
| `create_call` | Start outbound call (immediate or scheduled) |

### Phone Numbers
| Tool | Description |
|------|-------------|
| `list_phone_numbers` | List phone numbers |
| `get_phone_number` | Get phone number details |

### Tools (Function Calling)
| Tool | Description |
|------|-------------|
| `list_tools` | List custom tools |
| `get_tool` | Get tool details |
| `create_tool` | Create tool for API integration |
| `update_tool` | Update tool |

---

## Development

```bash
# Install dependencies
npm install

# Build
npm run build

# Test with MCP inspector
npm run inspector
```

### Local Development Config

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

### Testing

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

### Input validation from OpenAPI

All nine parameterized MCP tools use imported OpenAPI constraints through
Zod's experimental `z.fromJSONSchema()`, pinned to Zod 4.6.7. This covers
assistant names/LLMs/voices/transcribers, call schedules and customer numbers,
lookup/update IDs, function parameters, transfer destinations, HTTP methods,
timeouts and retry plans. The four list tools have local empty input schemas.

`src/schemas/assistant-openapi.json` is the shared compact projection for these
surfaces (the filename is retained from the initial assistant cutover). It
records the [public API spec](https://api.vapi.ai/api-json) source SHA-256 and
includes the recursive JSON-schema definitions needed for function parameters
and request bodies. Builds and installs use it without network access. Refresh
explicitly with `npm run schemas:snapshot`, or pass a saved spec with
`npm run schemas:snapshot -- /path/spec.json`.

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
Variants requiring fields outside the current interface remain excluded: custom
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
the advertised summary is intentionally broader. Catalog tests cap the current
serialized tool list at 20 KB to prevent unexpected agent-context growth.

`npm test` includes schema contract tests, independent Ajv parity cases, and
validation-feedback tests. The existing live compatibility
suites cover read-only resources and disposable assistants/custom tools.

---

## References

- [Vapi Documentation](https://docs.vapi.ai)
- [Vapi Dashboard](https://dashboard.vapi.ai)
- [Vapi Remote MCP Server](https://mcp.vapi.ai/)
- [Model Context Protocol](https://modelcontextprotocol.com/)

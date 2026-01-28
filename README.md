# Vapi MCP Server

[![smithery badge](https://smithery.ai/badge/@VapiAI/vapi-mcp-server)](https://smithery.ai/server/@VapiAI/vapi-mcp-server)

Build AI voice assistants and phone agents with [Vapi](https://vapi.ai) using the [Model Context Protocol](https://modelcontextprotocol.com/).

<a href="https://glama.ai/mcp/servers/@VapiAI/mcp-server">
  <img width="380" height="200" src="https://glama.ai/mcp/servers/@VapiAI/mcp-server/badge" alt="Vapi Server MCP server" />
</a>

## Claude Code Setup (Recommended)

The easiest way to get started. No API key needed - authenticate via browser on first use.

### 1. Add MCP Server

```bash
claude mcp add vapi -- npx -y @vapi-ai/mcp-server
```

### 2. Install Skill (Optional)

The Vapi skill helps Claude guide you through building voice assistants:

```bash
mkdir -p ~/.claude/skills/vapi
curl -o ~/.claude/skills/vapi/SKILL.md https://raw.githubusercontent.com/VapiAI/mcp-server/main/skill/SKILL.md
```

### 3. Restart Claude Code

After restarting, use `/vapi` or ask Claude to help build a voice assistant. On first use, you'll be prompted to sign in via browser - no API key copy-paste needed.

---

## Claude Desktop Setup

### With OAuth (No API Key)

```json
{
  "mcpServers": {
    "vapi": {
      "command": "npx",
      "args": ["-y", "@vapi-ai/mcp-server"]
    }
  }
}
```

### With API Key

If you prefer to use an API key directly, get one from the [Vapi dashboard](https://dashboard.vapi.ai/org/api-keys):

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

### Remote Configuration

Connect to Vapi's hosted MCP server:

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

---

## Example Usage

### Create a Voice Assistant

Ask Claude:
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
| `vapi_list_assistants` | List all assistants |
| `vapi_get_assistant` | Get assistant by ID |
| `vapi_create_assistant` | Create new assistant |
| `vapi_update_assistant` | Update assistant |
| `vapi_delete_assistant` | Delete assistant |

### Calls
| Tool | Description |
|------|-------------|
| `vapi_list_calls` | List call history |
| `vapi_get_call` | Get call details |
| `vapi_create_call` | Start outbound call (immediate or scheduled) |

### Phone Numbers
| Tool | Description |
|------|-------------|
| `vapi_list_phone_numbers` | List phone numbers |
| `vapi_get_phone_number` | Get phone number details |
| `vapi_buy_phone_number` | Purchase new number |
| `vapi_update_phone_number` | Update number settings |
| `vapi_delete_phone_number` | Release number |

### Tools (Function Calling)
| Tool | Description |
|------|-------------|
| `vapi_list_tools` | List custom tools |
| `vapi_get_tool` | Get tool details |
| `vapi_create_tool` | Create tool for API integration |
| `vapi_update_tool` | Update tool |
| `vapi_delete_tool` | Delete tool |

### Authentication
| Tool | Description |
|------|-------------|
| `vapi_login` | Start OAuth flow |
| `vapi_auth_status` | Check auth status |

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
# Unit tests (mocked)
npm run test:unit

# E2E tests (requires VAPI_TOKEN)
export VAPI_TOKEN=your_token_here
npm run test:e2e

# All tests
npm test
```

---

## References

- [Vapi Documentation](https://docs.vapi.ai)
- [Vapi Dashboard](https://dashboard.vapi.ai)
- [Vapi Remote MCP Server](https://mcp.vapi.ai/)
- [Model Context Protocol](https://modelcontextprotocol.com/)

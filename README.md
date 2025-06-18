# Vapi MCP Server

[![smithery badge](https://smithery.ai/badge/@VapiAI/vapi-mcp-server)](https://smithery.ai/server/@VapiAI/vapi-mcp-server)

The Vapi [Model Context Protocol](https://modelcontextprotocol.com/) server allows you to integrate with Vapi APIs through function calling.

<a href="https://glama.ai/mcp/servers/@VapiAI/mcp-server">
  <img width="380" height="200" src="https://glama.ai/mcp/servers/@VapiAI/mcp-server/badge" alt="Vapi Server MCP server" />
</a>

## Claude Desktop Setup

1. Open `Claude Desktop` and press `CMD + ,` to go to `Settings`.
2. Click on the `Developer` tab.
3. Click on the `Edit Config` button.
4. This will open the `claude_desktop_config.json` file in your file explorer.
5. Get your Vapi API key from the Vapi dashboard (<https://dashboard.vapi.ai/org/api-keys>).
6. Add the following to your `claude_desktop_config.json` file. See [here](https://modelcontextprotocol.io/quickstart/user) for more details.
7. Restart the Claude Desktop after editing the config file.

### Local Configuration

```json
{
  "mcpServers": {
    "vapi-mcp-server": {
      "command": "npx",
      "args": [
          "-y",
          "@vapi-ai/mcp-server"
      ],
      "env": {
        "VAPI_TOKEN": "<your_vapi_token>"
      }
    }
  }
}
```

### Remote Configuration

```json
{
  "mcpServers": {
    "vapi-mcp": {
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

### Example Usage with Claude Desktop

1. Create or import a phone number using the Vapi dashboard (<https://dashboard.vapi.ai/phone-numbers>).
2. Create a new assistant using the existing 'Appointment Scheduler' template in the Vapi dashboard (<https://dashboard.vapi.ai/assistants>).
3. Make sure to configure Claude Desktop to use the Vapi MCP server and restart the Claude Desktop app.
4. Ask Claude to initiate or schedule a call. See examples below:

**Example 1:** Request an immediate call

```md
I'd like to speak with my ShopHelper assistant to talk about my recent order. Can you have it call me at +1234567890?
```

**Example 2:** Schedule a future call

```md
I need to schedule a call with Mary assistant for next Tuesday at 3:00 PM. My phone number is +1555123456.
```

**Example 3:** Make a call with dynamic variables

```md
I want to call +1234567890 with my appointment reminder assistant. Use these details:
- Customer name: Sarah Johnson
- Appointment date: March 25th
- Appointment time: 2:30 PM
- Doctor name: Dr. Smith
```

## Using Variable Values in Assistant Prompts

The `create_call` action supports passing dynamic variables through `assistantOverrides.variableValues`. These variables can be used in your assistant's prompts using double curly braces: `{{variableName}}`.

### Example Assistant Prompt with Variables

```
Hello {{customerName}}, this is a reminder about your appointment on {{appointmentDate}} at {{appointmentTime}} with {{doctorName}}.
```

### Default Variables

The following variables are automatically available (no need to pass in variableValues):

- `{{now}}` - Current date and time (UTC)
- `{{date}}` - Current date (UTC)
- `{{time}}` - Current time (UTC)
- `{{month}}` - Current month (UTC)
- `{{day}}` - Current day of month (UTC)
- `{{year}}` - Current year (UTC)
- `{{customer.number}}` - Customer's phone number

For more details on default variables and advanced date/time formatting, see the [official Vapi documentation](https://docs.vapi.ai/assistants/dynamic-variables#default-variables).

## Remote MCP

To connect to Vapi's MCP server remotely:

### Streamable HTTP (Recommended)

The default and recommended way to connect is via Streamable HTTP Transport:

- Connect to `https://mcp.vapi.ai/mcp` from any MCP client using Streamable HTTP Transport
- Include your Vapi API key as a bearer token in the request headers
- Example header: `Authorization: Bearer your_vapi_api_key_here`

### SSE (Deprecated)

Server-Sent Events (SSE) Transport is still supported but deprecated:

- Connect to `https://mcp.vapi.ai/sse` from any MCP client using SSE Transport
- Include your Vapi API key as a bearer token in the request headers
- Example header: `Authorization: Bearer your_vapi_api_key_here`

This connection allows you to access Vapi's functionality remotely without running a local server.

## Development

```bash
# Install dependencies
npm install

# Build the server
npm run build

# Use inspector to test the server
npm run inspector
```

Update your `claude_desktop_config.json` to use the local server.

```json
{
  "mcpServers": {
    "vapi-local": {
      "command": "node",
      "args": [
        "<path_to_vapi_mcp_server>/dist/index.js"
      ],
      "env": {
        "VAPI_TOKEN": "<your_vapi_token>"
      }
    },
  }
}
```

### Testing

The project has two types of tests:

#### Unit Tests

Unit tests use mocks to test the MCP server without making actual API calls to Vapi.

```bash
# Run unit tests
npm run test:unit
```

#### End-to-End Tests

E2E tests run the full MCP server with actual API calls to Vapi.

```bash
# Set your Vapi API token
export VAPI_TOKEN=your_token_here

# Run E2E tests
npm run test:e2e
```

Note: E2E tests require a valid Vapi API token to be set in the environment.

#### Running All Tests

To run all tests at once:

```bash
npm test
```

## References

- [VAPI Remote MCP Server](https://mcp.vapi.ai/)
- [VAPI MCP Tool](https://docs.vapi.ai/tools/mcp)
- [VAPI MCP Server SDK](https://docs.vapi.ai/sdk/mcp-server)
- [Model Context Protocol](https://modelcontextprotocol.com/)
- [Claude Desktop](https://modelcontextprotocol.io/quickstart/user)

## Supported Actions

The Vapi MCP Server provides the following tools for integration:

### Assistant Tools

- `list_assistants`: Lists all Vapi assistants
- `create_assistant`: Creates a new Vapi assistant
- `update_assistant`: Updates an existing Vapi assistant
- `get_assistant`: Gets a Vapi assistant by ID

### Call Tools

- `list_calls`: Lists all Vapi calls
- `create_call`: Creates an outbound call with support for:
  - Immediate or scheduled calls
  - Dynamic variable values through `assistantOverrides`
- `get_call`: Gets details of a specific call

> **Note:** The `create_call` action supports scheduling calls for immediate execution or for a future time. You can also pass dynamic variables using `assistantOverrides.variableValues` to personalize assistant messages.

### Phone Number Tools

- `list_phone_numbers`: Lists all Vapi phone numbers
- `get_phone_number`: Gets details of a specific phone number

### Vapi Tools

- `list_tools`: Lists all Vapi tools
- `get_tool`: Gets details of a specific tool

---
name: vapi
description: Build AI voice assistants and phone agents with Vapi. Use this skill when users want to create voice agents, phone bots, IVR systems, outbound calling campaigns, or any voice-based AI application.
---

# Vapi - AI Voice Assistant Builder

Build AI-powered voice assistants, phone agents, and conversational AI applications with Vapi.

## When This Skill is Activated

When a user wants to build a voice assistant or phone agent, follow these steps:

### Step 1: Check if Vapi MCP is Installed

First, check if the Vapi MCP server is available by looking for `vapi_` tools. If not available, tell the user to run:

```bash
claude mcp add vapi -- npx -y @vapi-ai/mcp-server
```

Then restart Claude Code and continue with Step 2.

### Step 2: Authenticate with Vapi

If the user hasn't authenticated yet (tools return auth errors):

1. Call `vapi_login` to start the OAuth flow
2. Tell the user to open the provided URL and sign in
3. Once authenticated, proceed with their request

### Step 3: Build the Voice Assistant

Before creating an assistant, fetch the latest prompt engineering guidelines from the [Prompt Guide](https://raw.githubusercontent.com/VapiAI/mcp-server/main/skill/PROMPT_GUIDE.md).

Use these guidelines to craft effective voice assistant prompts based on what the user wants to build.

## Available Tools

### Authentication
- `vapi_login` - Start OAuth authentication flow
- `vapi_auth_status` - Check if authenticated

### Assistants
- `vapi_list_assistants` - List all assistants
- `vapi_get_assistant` - Get assistant details
- `vapi_create_assistant` - Create new assistant
- `vapi_update_assistant` - Update assistant
- `vapi_delete_assistant` - Delete assistant

### Calls
- `vapi_list_calls` - List call history
- `vapi_get_call` - Get call details
- `vapi_create_call` - Start outbound call

### Phone Numbers
- `vapi_list_phone_numbers` - List phone numbers
- `vapi_buy_phone_number` - Purchase new number
- `vapi_update_phone_number` - Update number settings
- `vapi_delete_phone_number` - Release number

### Tools (Function Calling)
- `vapi_list_tools` - List custom tools
- `vapi_create_tool` - Create tool for API integration
- `vapi_update_tool` - Update tool
- `vapi_delete_tool` - Delete tool

## Workflow Examples

**User:** "I want to build a voice assistant that can schedule appointments"

**Claude should:**
1. Check for Vapi MCP -> install if needed
2. Authenticate if needed
3. Fetch the prompt guide for best practices
4. Ask about their business to understand context
5. Create an assistant with a scheduling-focused prompt
6. Offer to set up a phone number
7. Help create calendar integration tools if needed

**User:** "Make me a phone bot that answers questions about my business"

**Claude should:**
1. Ensure Vapi MCP is installed and authenticated
2. Fetch the prompt guide for best practices
3. Ask about the business: name, services, hours, common questions
4. Craft a system prompt following the guidelines
5. Create the assistant
6. Help provision or connect a phone number
7. Offer to test with a sample call

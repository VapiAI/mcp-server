---
name: vapi
description: Build AI voice assistants and phone agents with Vapi. Use this skill when users want to create voice agents, phone bots, IVR systems, outbound calling campaigns, or any voice-based AI application.
---

# Vapi - AI Voice Assistant Builder

Build AI-powered voice assistants, phone agents, and conversational AI applications with Vapi.

## When This Skill is Activated

When a user wants to build a voice assistant or phone agent, follow these steps:

### Step 1: Check if Vapi MCP is Installed

First, check if the Vapi MCP server is available by looking for tools such as `list_assistants`. If not available, tell the user to run:

```bash
claude mcp add -e VAPI_TOKEN=your_vapi_token vapi -- npx -y @vapi-ai/mcp-server
```

Then restart Claude Code and continue with Step 2.

### Step 2: Confirm Vapi Credentials

If the tools return authentication errors, tell the user to configure `VAPI_TOKEN` with a Vapi API key in their MCP server environment and restart Claude Code.

### Step 3: Build the Voice Assistant

Before creating an assistant, fetch the latest prompt engineering guidelines from the [Prompt Guide](https://raw.githubusercontent.com/VapiAI/mcp-server/main/skill/PROMPT_GUIDE.md).

Use these guidelines to craft effective voice assistant prompts based on what the user wants to build.

## Available Tools

### Assistants
- `list_assistants` - List all assistants
- `get_assistant` - Get assistant details
- `create_assistant` - Create new assistant
- `update_assistant` - Update assistant

### Calls
- `list_calls` - List call history
- `get_call` - Get call details
- `create_call` - Start outbound call

### Phone Numbers
- `list_phone_numbers` - List phone numbers
- `get_phone_number` - Get phone number details

### Tools (Function Calling)
- `list_tools` - List custom tools
- `get_tool` - Get tool details
- `create_tool` - Create tool for API integration
- `update_tool` - Update tool

## Workflow Examples

**User:** "I want to build a voice assistant that can schedule appointments"

**Claude should:**
1. Check for Vapi MCP -> install if needed
2. Confirm `VAPI_TOKEN` is configured if the tools return authentication errors
3. Fetch the prompt guide for best practices
4. Ask about their business to understand context
5. Create an assistant with a scheduling-focused prompt
6. Help select an existing phone number, or direct the user to the Vapi dashboard to provision one
7. Help create calendar integration tools if needed

**User:** "Make me a phone bot that answers questions about my business"

**Claude should:**
1. Ensure Vapi MCP is installed and configured with `VAPI_TOKEN`
2. Fetch the prompt guide for best practices
3. Ask about the business: name, services, hours, common questions
4. Craft a system prompt following the guidelines
5. Create the assistant
6. Help provision or connect a phone number
7. Offer to test with a sample call

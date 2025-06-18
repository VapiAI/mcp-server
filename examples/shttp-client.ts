#!/usr/bin/env node

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import dotenv from 'dotenv';
import { parseToolResponse } from '../src/utils/response.js';

// Load environment variables from .env file
dotenv.config();

// Ensure API key is available
if (!process.env.VAPI_TOKEN) {
  console.error('Error: VAPI_TOKEN environment variable is required');
  process.exit(1);
}

async function main() {
  try {
    // Initialize MCP client
    const mcpClient = new Client({
      name: 'vapi-client-example',
      version: '1.0.0',
    });

    // Create Streamable HTTP transport for connection to remote Vapi MCP server
    const serverUrl = 'https://mcp.vapi.ai/mcp';
    const headers = {
      Authorization: `Bearer ${process.env.VAPI_TOKEN}`,
    };

    const transport = new StreamableHTTPClientTransport(new URL(serverUrl), {
      requestInit: { headers },
    });

    console.log('Connecting to Vapi MCP server via Streamable HTTP...');
    await mcpClient.connect(transport);
    console.log('Connected successfully');

    try {
      // List available tools
      const toolsResult = await mcpClient.listTools();
      console.log('Available tools:');
      toolsResult.tools.forEach((tool) => {
        console.log(`- ${tool.name}: ${tool.description}`);
      });

      // List assistants
      console.log('\nListing assistants...');
      const assistantsResponse = await mcpClient.callTool({
        name: 'list_assistants',
        arguments: {},
      });

      const assistants = parseToolResponse(assistantsResponse);

      if (!(Array.isArray(assistants) && assistants.length > 0)) {
        console.log(
          'No assistants found. Please create an assistant in the Vapi dashboard first.'
        );
        return;
      }

      console.log('Your assistants:');
      assistants.forEach((assistant: any) => {
        console.log(`- ${assistant.name} (${assistant.id})`);
      });

      // List phone numbers
      console.log('\nListing phone numbers...');
      const phoneNumbersResponse = await mcpClient.callTool({
        name: 'list_phone_numbers',
        arguments: {},
      });

      const phoneNumbers = parseToolResponse(phoneNumbersResponse);

      if (!(Array.isArray(phoneNumbers) && phoneNumbers.length > 0)) {
        console.log(
          'No phone numbers found. Please add a phone number in the Vapi dashboard first.'
        );
        return;
      }

      console.log('Your phone numbers:');
      phoneNumbers.forEach((phoneNumber: any) => {
        console.log(`- ${phoneNumber.phoneNumber} (${phoneNumber.id})`);
      });

      // Create a call using the first assistant and first phone number
      const phoneNumberId = phoneNumbers[0].id;
      const assistantId = assistants[0].id;

      console.log(
        `\nCreating a call using assistant (${assistantId}) and phone number (${phoneNumberId})...`
      );
      const createCallResponse = await mcpClient.callTool({
        name: 'create_call',
        arguments: {
          assistantId: assistantId,
          phoneNumberId: phoneNumberId,
          customer: {
            phoneNumber: '+1234567890', // Replace with actual customer phone number
          },
          assistantOverrides: {
            variableValues: {
              name: 'John Doe',
              age: '25',
            },
          },
          // Optional: schedule a call for the future
          // scheduledAt: "2025-04-15T15:30:00Z"
        },
      });

      const createdCall = parseToolResponse(createCallResponse);
      console.log('Call created:', JSON.stringify(createdCall, null, 2));

      // List calls
      console.log('\nListing calls...');
      const callsResponse = await mcpClient.callTool({
        name: 'list_calls',
        arguments: {},
      });

      const calls = parseToolResponse(callsResponse);

      if (Array.isArray(calls) && calls.length > 0) {
        console.log('Your calls:');
        calls.forEach((call: any) => {
          const createdAt = call.createdAt
            ? new Date(call.createdAt).toLocaleString()
            : 'N/A';
          const customerPhone = call.customer?.phoneNumber || 'N/A';
          const endedReason = call.endedReason || 'N/A';

          console.log(
            `- ID: ${call.id} | Status: ${call.status} | Created: ${createdAt} | Customer: ${customerPhone} | Ended reason: ${endedReason}`
          );
        });
      } else {
        console.log('No calls found. Try creating a call first.');
      }
    } finally {
      console.log('\nDisconnecting from server...');
      await mcpClient.close();
      console.log('Disconnected');
    }
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

main();

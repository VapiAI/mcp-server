import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, jest, test } from '@jest/globals';

jest.setTimeout(15_000);

const packageMetadata = JSON.parse(
  readFileSync(new URL('../../package.json', import.meta.url), 'utf8')
) as { version: string };

type JsonRpcResponse = {
  id?: number;
  result?: Record<string, any>;
  error?: Record<string, any>;
};

type PendingRequest = {
  resolve: (response: JsonRpcResponse) => void;
  reject: (error: Error) => void;
};

function startServer() {
  const child = spawn(process.execPath, [join(process.cwd(), 'dist', 'index.js')], {
    env: {
      ...process.env,
      VAPI_TOKEN: 'stdio-compat-test-token',
    },
    stdio: ['pipe', 'pipe', 'pipe'],
  }) as ChildProcessWithoutNullStreams;

  const pending = new Map<number, PendingRequest>();
  let nextId = 1;
  let stdoutBuffer = '';
  let stderrBuffer = '';

  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (chunk: string) => {
    stderrBuffer += chunk;
  });

  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (chunk: string) => {
    stdoutBuffer += chunk;
    const lines = stdoutBuffer.split('\n');
    stdoutBuffer = lines.pop() ?? '';

    for (const line of lines) {
      if (!line.trim()) continue;

      const response = JSON.parse(line) as JsonRpcResponse;
      if (response.id === undefined) continue;

      const request = pending.get(response.id);
      if (!request) continue;

      pending.delete(response.id);
      request.resolve(response);
    }
  });

  child.once('exit', (code, signal) => {
    if (pending.size === 0) return;

    const diagnostic = stderrBuffer.trim();
    const error = new Error(
      `MCP server exited before responding (code=${code}, signal=${signal})${
        diagnostic ? `: ${diagnostic}` : ''
      }`
    );
    for (const request of pending.values()) request.reject(error);
    pending.clear();
  });

  const request = (
    method: string,
    params?: Record<string, unknown>
  ): Promise<JsonRpcResponse> => {
    const id = nextId++;
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
      child.stdin.write(
        `${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`
      );
    });
  };

  const notify = (method: string, params?: Record<string, unknown>) => {
    child.stdin.write(
      `${JSON.stringify({ jsonrpc: '2.0', method, params })}\n`
    );
  };

  const close = async () => {
    if (child.exitCode !== null || child.signalCode !== null) return;

    const exited = new Promise<void>((resolve) => {
      child.once('exit', () => resolve());
    });
    child.kill('SIGINT');
    await exited;
  };

  return { request, notify, close };
}

// Exercise the locally built entrypoint over real stdio framing for every protocol version
// supported by the installed SDK. Host-specific smoke tests belong outside this suite.
const supportedProtocolVersions = [
  '2024-10-07',
  '2024-11-05',
  '2025-03-26',
  '2025-06-18',
  '2025-11-25',
];

describe('stdio MCP protocol compatibility', () => {
  test.each(supportedProtocolVersions)(
    'negotiates protocol %s and lists the complete catalog',
    async (protocolVersion) => {
      const server = startServer();

      try {
        const initialization = await server.request('initialize', {
          protocolVersion,
          capabilities: {},
          clientInfo: {
            name: 'stdio-compatibility-test',
            version: 'compat-test',
          },
        });

        expect(initialization.error).toBeUndefined();
        expect(initialization.result?.protocolVersion).toBe(protocolVersion);
        expect(initialization.result?.serverInfo).toEqual(
          expect.objectContaining({
            name: 'Vapi MCP',
            version: packageMetadata.version,
          })
        );
        expect(initialization.result?.capabilities).toEqual(
          expect.objectContaining({
            tools: expect.any(Object),
          })
        );

        server.notify('notifications/initialized');
        const catalog = await server.request('tools/list', {});

        expect(catalog.error).toBeUndefined();
        expect(catalog.result?.tools).toHaveLength(13);
      } finally {
        await server.close();
      }
    }
  );
});

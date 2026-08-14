#!/usr/bin/env node

import { spawn } from 'node:child_process';
import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const expectedToolNames = [
  'create_assistant',
  'create_call',
  'create_tool',
  'get_assistant',
  'get_call',
  'get_phone_number',
  'get_tool',
  'list_assistants',
  'list_calls',
  'list_phone_numbers',
  'list_tools',
  'update_assistant',
  'update_tool',
];

function run(command, args, options) {
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn(command, args, {
      ...options,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';

    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    child.once('error', rejectRun);
    child.once('exit', (code, signal) => {
      if (code === 0) {
        resolveRun({ stdout, stderr });
        return;
      }

      rejectRun(
        new Error(
          `${command} ${args.join(' ')} failed (code=${code}, signal=${signal})` +
            `${stderr.trim() ? `\n${stderr.trim()}` : ''}`
        )
      );
    });
  });
}

function startServer(binPath, workingDirectory) {
  const child = spawn(binPath, [], {
    cwd: workingDirectory,
    shell: process.platform === 'win32',
    env: {
      ...process.env,
      VAPI_TOKEN: 'package-smoke-test-token',
    },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  const pending = new Map();
  let nextId = 1;
  let stdoutBuffer = '';
  let stderrBuffer = '';

  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (chunk) => {
    stderrBuffer += chunk;
  });
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (chunk) => {
    stdoutBuffer += chunk;
    const lines = stdoutBuffer.split('\n');
    stdoutBuffer = lines.pop() ?? '';

    for (const line of lines) {
      if (!line.trim()) continue;

      let response;
      try {
        response = JSON.parse(line);
      } catch (error) {
        for (const request of pending.values()) request.reject(error);
        pending.clear();
        continue;
      }

      if (response.id === undefined) continue;
      const request = pending.get(response.id);
      if (!request) continue;

      pending.delete(response.id);
      clearTimeout(request.timeout);
      request.resolve(response);
    }
  });
  child.once('exit', (code, signal) => {
    const diagnostic = stderrBuffer.trim();
    const error = new Error(
      `Installed MCP server exited before responding (code=${code}, signal=${signal})` +
        `${diagnostic ? `: ${diagnostic}` : ''}`
    );
    for (const request of pending.values()) {
      clearTimeout(request.timeout);
      request.reject(error);
    }
    pending.clear();
  });

  const request = (method, params) => {
    const id = nextId++;
    return new Promise((resolveRequest, rejectRequest) => {
      const timeout = setTimeout(() => {
        pending.delete(id);
        rejectRequest(
          new Error(`Timed out waiting for MCP response to ${method}`)
        );
      }, 10_000);

      pending.set(id, {
        resolve: resolveRequest,
        reject: rejectRequest,
        timeout,
      });
      child.stdin.write(
        `${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`
      );
    });
  };

  const notify = (method, params) => {
    child.stdin.write(
      `${JSON.stringify({ jsonrpc: '2.0', method, params })}\n`
    );
  };

  const close = async () => {
    if (child.exitCode !== null || child.signalCode !== null) return;

    const exited = new Promise((resolveExit) => {
      child.once('exit', resolveExit);
    });
    child.kill();
    await Promise.race([
      exited,
      new Promise((resolveTimeout) => setTimeout(resolveTimeout, 2_000)),
    ]);
    if (child.exitCode === null && child.signalCode === null) {
      child.kill('SIGKILL');
      await exited;
    }
  };

  return { request, notify, close };
}

const temporaryRoot = await mkdtemp(join(tmpdir(), 'vapi-mcp-package-smoke-'));
const npmCacheDirectory = join(temporaryRoot, 'npm-cache');
let server;

try {
  const packageMetadata = JSON.parse(
    await readFile(join(repositoryRoot, 'package.json'), 'utf8')
  );
  const packResult = await run(
    npmCommand,
    [
      'pack',
      '--ignore-scripts',
      '--json',
      '--pack-destination',
      temporaryRoot,
      '--cache',
      npmCacheDirectory,
    ],
    { cwd: repositoryRoot }
  );
  const packed = JSON.parse(packResult.stdout);
  if (!Array.isArray(packed) || packed.length !== 1 || !packed[0].filename) {
    throw new Error(`Unexpected npm pack output: ${packResult.stdout}`);
  }

  const tarballPath = join(temporaryRoot, packed[0].filename);
  const consumerDirectory = join(temporaryRoot, 'consumer');
  await mkdir(consumerDirectory);
  await writeFile(
    join(consumerDirectory, 'package.json'),
    JSON.stringify({ name: 'vapi-mcp-package-smoke-consumer', private: true })
  );
  await run(
    npmCommand,
    [
      'install',
      '--ignore-scripts',
      '--no-audit',
      '--no-fund',
      tarballPath,
      '--cache',
      npmCacheDirectory,
    ],
    { cwd: consumerDirectory }
  );

  const installedPackageRoot = join(
    consumerDirectory,
    'node_modules',
    '@vapi-ai',
    'mcp-server'
  );
  const installedMetadata = JSON.parse(
    await readFile(join(installedPackageRoot, 'package.json'), 'utf8')
  );
  const declaredBins = Object.keys(installedMetadata.bin ?? {});
  if (declaredBins.length !== 1) {
    throw new Error(
      `Expected exactly one declared package bin, found ${declaredBins.length}`
    );
  }

  const executableName = declaredBins[0].split('/').pop();
  const binPath = join(
    consumerDirectory,
    'node_modules',
    '.bin',
    `${executableName}${process.platform === 'win32' ? '.cmd' : ''}`
  );
  await access(binPath);

  server = startServer(binPath, consumerDirectory);
  const initialization = await server.request('initialize', {
    protocolVersion: '2025-11-25',
    capabilities: {},
    clientInfo: {
      name: 'packed-package-smoke-client',
      version: '1.0.0',
    },
  });
  if (initialization.error) {
    throw new Error(
      `MCP initialization failed: ${JSON.stringify(initialization.error)}`
    );
  }
  if (initialization.result?.serverInfo?.version !== packageMetadata.version) {
    throw new Error(
      `Installed server version ${initialization.result?.serverInfo?.version} ` +
        `did not match package version ${packageMetadata.version}`
    );
  }

  server.notify('notifications/initialized');
  const catalog = await server.request('tools/list', {});
  if (catalog.error) {
    throw new Error(`tools/list failed: ${JSON.stringify(catalog.error)}`);
  }
  const actualToolNames = (catalog.result?.tools ?? [])
    .map((tool) => tool.name)
    .sort();
  if (JSON.stringify(actualToolNames) !== JSON.stringify(expectedToolNames)) {
    throw new Error(
      `Installed tool catalog did not match: ${JSON.stringify(actualToolNames)}`
    );
  }

  console.log(
    `Packed consumer smoke passed for ${packageMetadata.name}@${packageMetadata.version} ` +
      `with ${actualToolNames.length} tools`
  );
} finally {
  await server?.close();
  await rm(temporaryRoot, { recursive: true, force: true });
}

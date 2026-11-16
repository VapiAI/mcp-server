#!/usr/bin/env node
import { readSseResponse } from './runtime-sse.mjs';

import { spawn } from 'node:child_process';
import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { assertMismatchFails, contractCases, pendingCases, hostedMismatchControl, verifyContract } from './runtime-contract.mjs';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const expectedExecutableName = 'mcp-server';
const expectedToolNames = [
  'ask_vapi_docs',
  'create_assistant',
  'create_call',
  'create_simulation',
  'create_simulation_personality',
  'create_simulation_scenario',
  'create_simulation_suite',
  'create_tool',
  'get_api_schema',
  'get_assistant',
  'get_call',
  'get_phone_number',
  'get_simulation_run',
  'get_simulation_run_item',
  'get_tool',
  'list_assistants',
  'list_calls',
  'list_phone_numbers',
  'list_simulation_personalities',
  'list_simulation_runs',
  'list_simulation_scenarios',
  'list_simulation_suites',
  'list_simulations',
  'list_tools',
  'load_skill',
  'run_simulations',
  'search_skills',
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

function startHttpProbe(endpoint, token) {
  let nextId = 1;
  let sessionId;
  let protocolVersion;

  const request = async (method, params) => {
    const id = nextId++;
    const headers = {
      accept: 'application/json, text/event-stream',
      'content-type': 'application/json',
    };
    if (token) headers.authorization = `Bearer ${token}`;
    if (sessionId) headers['mcp-session-id'] = sessionId;
    if (protocolVersion) headers['mcp-protocol-version'] = protocolVersion;

    const response = await fetch(endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify({ jsonrpc: '2.0', id, method, params }),
      signal: AbortSignal.timeout(10_000),
      redirect: 'error',
    });
    if (!response.ok) {
      throw new Error(`Hosted MCP returned HTTP ${response.status} for ${method}`);
    }
    sessionId ??= response.headers.get('mcp-session-id') ?? undefined;
    const contentType = response.headers.get('content-type') ?? '';
    const body = contentType.includes('text/event-stream')
      ? await readSseResponse(response, id)
      : await response.json();
    if (method === 'initialize') {
      protocolVersion = body.result?.protocolVersion;
    }
    return body;
  };

  const notify = async (method, params) => {
    const headers = {
      accept: 'application/json, text/event-stream',
      'content-type': 'application/json',
    };
    if (token) headers.authorization = `Bearer ${token}`;
    if (sessionId) headers['mcp-session-id'] = sessionId;
    if (protocolVersion) headers['mcp-protocol-version'] = protocolVersion;
    const response = await fetch(endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify({ jsonrpc: '2.0', method, params }),
      signal: AbortSignal.timeout(10_000),
      redirect: 'error',
    });
    if (!response.ok) {
      throw new Error(`Hosted MCP returned HTTP ${response.status} for ${method}`);
    }
  };

  return { request, notify, close: async () => {} };
}


async function collectContract(probe, expected) {
  const initialize = await probe.request('initialize', {
    protocolVersion: expected.protocolVersion,
    capabilities: {},
    clientInfo: { name: 'vapi-runtime-contract', version: '1.0.0' },
  });
  await probe.notify('notifications/initialized');
  const toolsList = await probe.request('tools/list', {});
  const invalidRun = await probe.request('tools/call', {
    name: 'run_simulations', arguments: { assistantId: '00000000-0000-4000-8000-000000000001', simulationIds: ['00000000-0000-4000-8000-000000000002'], iterations: 11 },
  });
  const invalidSimulation = await probe.request('tools/call', {
    name: 'create_simulation_personality',
    arguments: { name: 'Contract', assistant: { maxDurationSeconds: 1 } },
  });
  return { initialize, toolsList, invalidRun, invalidSimulation };
}

function runtimeMetadata() {
  const packageVersion = JSON.parse(readFileSync(join(repositoryRoot, 'package.json'), 'utf8')).version;
  const contractDefinition = {
    cases: contractCases,
    protocolVersion: '2025-11-25',
    toolNames: expectedToolNames,
    validationPaths: ['iterations', 'assistant.maxDurationSeconds'],
  };
  return {
    packageVersion,
    sourceRevision: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repositoryRoot, encoding: 'utf8' }).trim(),
    sourceTreeDirty: execFileSync('git', ['status', '--porcelain'], { cwd: repositoryRoot, encoding: 'utf8' }).trim().length > 0,
    contractRevision: createHash('sha256')
      .update(JSON.stringify(contractDefinition))
      .update(readFileSync(fileURLToPath(import.meta.url)))
      .update(readFileSync(new URL('./runtime-contract.mjs', import.meta.url)))
      .update(readFileSync(new URL('./runtime-sse.mjs', import.meta.url)))
      .digest('hex'),
  };
}

async function verifyHostedRuntime(expected) {
  const endpointValue = process.env.MCP_CONTRACT_HOST_URL;
  if (!endpointValue) {
    return {
      status: 'pending',
      reason: 'MCP_CONTRACT_HOST_URL was not supplied',
      cases: [...contractCases, ...pendingCases].map((name) => ({ name, status: 'pending' })),
      caseCount: { passed: 0, pending: contractCases.length + pendingCases.length, total: contractCases.length + pendingCases.length },
    };
  }
  const environment = process.env.MCP_CONTRACT_HOST_ENV;
  const hostRevision = process.env.MCP_CONTRACT_HOST_REVISION;
  if (!['local', 'staging', 'preview'].includes(environment)) {
    throw new Error('Set MCP_CONTRACT_HOST_ENV to local, staging, or preview; production is not supported');
  }
  if (!hostRevision) throw new Error('Set MCP_CONTRACT_HOST_REVISION to the deployed host commit SHA');
  if (!/^[a-f0-9]{7,40}$/i.test(hostRevision)) {
    throw new Error('MCP_CONTRACT_HOST_REVISION must be a 7-40 character Git commit SHA');
  }

  const endpoint = new URL(endpointValue);
  if (endpoint.protocol !== 'https:' && !['localhost', '127.0.0.1', '::1'].includes(endpoint.hostname)) {
    throw new Error('Hosted contract targets must use HTTPS (HTTP is allowed only on loopback)');
  }
  if (endpoint.hostname === 'mcp.vapi.ai') {
    throw new Error('The production mcp.vapi.ai endpoint is not an allowed contract target');
  }
  if (endpoint.username || endpoint.password || endpoint.search || endpoint.hash) {
    throw new Error('Put credentials in MCP_CONTRACT_HOST_TOKEN, not in the endpoint URL');
  }

  const probe = startHttpProbe(endpoint, process.env.MCP_CONTRACT_HOST_TOKEN);
  try {
    const observation = await collectContract(probe, { ...expected, serverVersion: undefined, allowExtraTools: true });
    const result = verifyContract(observation, { ...expected, serverVersion: undefined, allowExtraTools: true });
    return {
      status: result.passed ? 'pending' : 'failed',
      identity: { status: 'pending', reason: 'Host package and contract identity are not exposed by the endpoint' },
      environment,
      endpoint: `${endpoint.origin}${endpoint.pathname}`,
      revision: hostRevision,
      revisionSource: 'operator-supplied deployment record',
      serverInfo: result.serverInfo ?? null,
      identityMismatchControl: result.passed ? hostedMismatchControl(observation, expected) : { status: 'pending', reason: 'Behavioral control did not pass' },
      hostOnlyTools: result.actualToolNames.filter((name) => !expected.toolNames.includes(name)),
      failures: result.failures,
      cases: contractCases.map((name) => ({
        name,
        status: result.failures.some((failure) => failure.name === name) ? 'failed' : 'passed',
      })).concat(pendingCases.map((name) => ({ name, status: 'pending' }))),
      caseCount: {
        passed: contractCases.filter((name) => !result.failures.some((failure) => failure.name === name)).length,
        failed: [...new Set(result.failures.map((failure) => failure.name))].length,
        pending: pendingCases.length,
        total: contractCases.length + pendingCases.length,
      },
    };
  } catch (error) {
    return {
      status: 'failed',
      environment,
      endpoint: `${endpoint.origin}${endpoint.pathname}`,
      revision: hostRevision,
      revisionSource: 'operator-supplied deployment record',
      reason: error instanceof Error ? error.message : 'Hosted contract request failed',
      cases: [...contractCases, ...pendingCases].map((name) => ({ name, status: 'pending' })),
      caseCount: { passed: 0, pending: contractCases.length + pendingCases.length, total: contractCases.length + pendingCases.length },
    };
  } finally {
    await probe.close();
  }
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
  if (declaredBins[0] !== expectedExecutableName) {
    throw new Error(
      `Expected package bin "${expectedExecutableName}" so npx can resolve it, ` +
        `found "${declaredBins[0]}"`
    );
  }

  const binPath = join(
    consumerDirectory,
    'node_modules',
    '.bin',
    `${expectedExecutableName}${process.platform === 'win32' ? '.cmd' : ''}`
  );
  await access(binPath);

  server = startServer(binPath, consumerDirectory);
  const expected = {
    protocolVersion: '2025-11-25',
    toolNames: expectedToolNames,
    serverName: 'Vapi MCP',
    serverVersion: packageMetadata.version,
  };
  const observation = await collectContract(server, expected);
  const initialization = observation.initialize;
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

  const catalog = observation.toolsList;
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

  const invalidInput = observation.invalidRun;
  const validation = invalidInput.result?.structuredContent?.validationError;
  if (invalidInput.error || invalidInput.result?.isError !== true ||
      validation?.code !== 'INVALID_ARGUMENTS' || validation.issues?.[0]?.path !== 'iterations') {
    throw new Error('Packed consumer did not return the expected field-level validation error');
  }

  const invalidSimulation = observation.invalidSimulation;
  const simulationValidation = invalidSimulation.result?.structuredContent?.validationError;
  if (invalidSimulation.error || invalidSimulation.result?.isError !== true ||
      simulationValidation?.code !== 'INVALID_ARGUMENTS' ||
      simulationValidation.issues?.[0]?.path !== 'assistant.maxDurationSeconds') {
    throw new Error('Packed consumer did not validate the bundled nested simulation contract');
  }

  const packageResult = verifyContract(observation, expected);
  if (!packageResult.passed) {
    throw new Error(`Packed runtime contract failed: ${JSON.stringify(packageResult.failures)}`);
  }
  assertMismatchFails(observation, expected);

  const runtime = runtimeMetadata();
  const hosted = await verifyHostedRuntime({ protocolVersion: expected.protocolVersion, toolNames: expectedToolNames });
  const report = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    contractRevision: runtime.contractRevision,
    cases: contractCases,
    pendingCases,
    package: {
      name: packageMetadata.name,
      version: packageMetadata.version,
      revision: runtime.sourceRevision,
      sourceTreeDirty: runtime.sourceTreeDirty,
      artifactIntegrity: packed[0].integrity ?? null,
      status: 'packed-local',
      result: { status: 'pending', cases: pendingCases.map((name) => ({ name, status: 'pending' })), caseCount: { passed: contractCases.length, pending: pendingCases.length, total: contractCases.length + pendingCases.length } },
    },
    hosted,
    releaseLifecycle: { merged: 'not-checked', published: 'not-checked', deployed: 'not-checked' },
    controls: { intentionalVersionMismatch: 'failed-as-expected' },
  };
  const reportPath = process.env.MCP_CONTRACT_REPORT;
  if (reportPath) await writeFile(resolve(reportPath), `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify(report, null, 2));
  if (process.env.MCP_CONTRACT_HOST_URL && hosted.status !== 'passed') process.exitCode = 1;
} finally {
  await server?.close();
  await rm(temporaryRoot, { recursive: true, force: true });
}

import assert from 'node:assert/strict';

export const contractCases = [
  'initialize',
  'tools/list',
  'invalid_run_iterations',
  'invalid_nested_simulation_arguments',
];

export function verifyContract(observation, expected) {
  const failures = [];
  const check = (name, predicate, detail) => {
    if (!predicate) failures.push({ name, detail });
  };

  check('initialize', observation.initialize?.error === undefined,
    'MCP initialize returned a protocol error');
  check('initialize', observation.initialize?.result?.protocolVersion === expected.protocolVersion,
    `protocol version was ${observation.initialize?.result?.protocolVersion ?? 'missing'}`);
  check('tools/list', observation.toolsList?.error === undefined,
    'tools/list returned a protocol error');
  const actualToolNames = (observation.toolsList?.result?.tools ?? [])
    .map((tool) => tool.name)
    .sort();
  const catalogMatches = expected.allowExtraTools
    ? expected.toolNames.every((name) => actualToolNames.includes(name))
    : JSON.stringify(actualToolNames) === JSON.stringify(expected.toolNames);
  check('tools/list', catalogMatches,
    `tool catalog differed (${actualToolNames.length} tools; ${expected.allowExtraTools ? 'missing required names' : 'expected exact catalog'})`);

  check('invalid_run_iterations', isValidationFailure(observation.invalidRun, 'iterations'),
    'invalid run_simulations input did not return structured field validation');
  check('invalid_nested_simulation_arguments', isValidationFailure(observation.invalidSimulation, 'assistant.maxDurationSeconds'),
    'invalid nested simulation input did not return structured field validation');

  const serverInfo = observation.initialize?.result?.serverInfo;
  if (expected.serverName) {
    check('initialize', serverInfo?.name === expected.serverName,
      `server name was ${serverInfo?.name ?? 'missing'}`);
  }
  if (expected.serverVersion) {
    check('initialize', serverInfo?.version === expected.serverVersion,
      `server version was ${serverInfo?.version ?? 'missing'}, expected ${expected.serverVersion}`);
  }

  return { passed: failures.length === 0, failures, actualToolNames, serverInfo };
}

function isValidationFailure(response, expectedPath) {
  const validation = response?.result?.structuredContent?.validationError;
  return response?.error === undefined && response?.result?.isError === true &&
    validation?.code === 'INVALID_ARGUMENTS' && Array.isArray(validation.issues) &&
    validation.issues.some((issue) => issue.path === expectedPath);
}

// Exercise the fail-closed comparator using a revision mismatch. This control
// runs against the observation captured from the real MCP endpoint.
export function assertMismatchFails(observation, expected) {
  const mismatch = verifyContract(observation, {
    ...expected,
    serverVersion: `${expected.serverVersion}-intentional-mismatch`,
  });
  assert.equal(mismatch.passed, false, 'a mismatched runtime version must fail the contract');
  assert(mismatch.failures.some((failure) => failure.name === 'initialize'),
    'mismatch control must identify initialization metadata as the failure');
}

// These guarantees require controlled fixtures and their owning delivery changes.
export const pendingCases = [
  'execution_error', 'result_completeness', 'read_only_denial',
  'cancellation_deadline', 'retry_safety', 'host_identity',
];

// A matching catalog cannot establish which package is running in the host.
export function hostedMismatchControl(observation, expected) {
  const stale = structuredClone(observation);
  stale.initialize.result.serverInfo = { name: 'Vapi MCP', version: '0.0.1' };
  const behavioral = verifyContract(stale, { ...expected, allowExtraTools: true });
  if (!behavioral.passed) throw new Error('Hosted mismatch control requires a passing behavioral observation');
  return { status: 'pending', reason: 'Stale host identity cannot be verified from the current protocol' };
}

import type { FixtureState, ScorerInput, ScenarioScore, StateAssertion } from './types.js';

function deepIncludes(actual: unknown, expected: unknown): boolean {
  if (expected && typeof expected === 'object' && !Array.isArray(expected)) {
    if (!actual || typeof actual !== 'object' || Array.isArray(actual)) return false;
    return Object.entries(expected).every(([key, value]) =>
      deepIncludes((actual as Record<string, unknown>)[key], value)
    );
  }
  if (Array.isArray(expected)) {
    return Array.isArray(actual) && expected.every(value =>
      actual.some(item => deepIncludes(item, value))
    );
  }
  return Object.is(actual, expected);
}

function assertionLabel(assertion: StateAssertion): string {
  return `${assertion.collection} matching ${JSON.stringify(assertion.where)} (expected ${assertion.count ?? 1}, found)`;
}

function unmetAssertions(fixture: FixtureState, assertions: StateAssertion[] = []): string[] {
  return assertions.flatMap(assertion => {
    const rows = fixture[assertion.collection] as Record<string, unknown>[];
    const count = rows.filter(row => deepIncludes(row, assertion.where)).length;
    return count === (assertion.count ?? 1) ? [] : [`${assertionLabel(assertion)} ${count}`];
  });
}

function unmetActions(fixture: FixtureState, patterns: string[] = []): string[] {
  const actions = fixture.actions.map(action => `${action.method} ${action.path}`);
  return patterns.filter(pattern => !actions.some(action => action.includes(pattern))).map(pattern => `missing fixture action ${pattern}`);
}

export function scoreScenario(input: ScorerInput): ScenarioScore {
  const { scenario, toolCalls, fixture, answer, providerError } = input;
  if (providerError) {
    return {
      status: 'inconclusive', classification: 'harness-provider-failure', taskCompleted: false,
      toolSelectionErrors: 0, invalidArguments: 0, unintendedMutations: 0, correctionAttempts: 0,
      forbiddenCalls: [], unmetStateAssertions: [], answerMatched: false,
    };
  }

  const optionalKnowledgeTools = new Set(['search_skills', 'load_skill', 'ask_vapi_docs']);
  const allowed = new Set([...scenario.relevantTools, ...optionalKnowledgeTools]);
  const toolSelectionErrors = toolCalls.filter(call => !allowed.has(call.toolName)).length;
  const forbidden = new Set(scenario.forbiddenTools ?? []);
  const forbiddenCalls = toolCalls.filter(call => forbidden.has(call.toolName)).map(call => call.toolName);
  const invalidArguments = input.validationErrors?.length ?? 0;
  const unmetStateAssertions = [...unmetAssertions(fixture, scenario.stateAssertions), ...unmetActions(fixture, scenario.requiredActionPatterns)];
  if (scenario.id === 'authorized-scheduled-call' && !fixture.actions.some(a => a.method === 'GET' && a.path === `/call/${fixture.calls[0]?.id}`)) unmetStateAssertions.push('scheduled call was not inspected');
  if (scenario.id === 'transcript-capability-gap' && !fixture.actions.some(a => a.method === 'GET' && a.path.startsWith('/call'))) unmetStateAssertions.push('call history was not inspected');
  if (scenario.id === 'callable-tool-update') {
    const tool = fixture.tools.find(t => t.id === '00000000-0000-4000-8000-000000000004');
    const description = String((tool?.function as Record<string, unknown> | undefined)?.description ?? '');
    if (!/availab|open/i.test(description) || !/appointment|slot/i.test(description)) unmetStateAssertions.push('tool description does not describe available appointment slots');
  }
  if (scenario.id === 'callable-tool-create-attach') {
    const tool = fixture.tools.find(t => (t.function as Record<string, unknown> | undefined)?.name === 'lookup_open_slots');
    const fn = tool?.function as Record<string, unknown> | undefined;
    const parameters = fn?.parameters as Record<string, unknown> | undefined;
    const properties = parameters?.properties as Record<string, unknown> | undefined;
    if (tool?.type !== 'function' || (tool?.server as Record<string, unknown> | undefined)?.url !== 'https://appointments.example.test/slots' || !properties || !Object.keys(properties).some(k => /date/i.test(k))) unmetStateAssertions.push('callable tool endpoint or date parameter missing');
  }
  if (scenario.id === 'simulation-suite-build-run') {
    const suite = fixture.simulationSuites.find(x => x.name === 'Harbor Rescheduling Checks');
    const simulation = fixture.simulations.find(x => Array.isArray(suite?.simulationIds) && suite.simulationIds.includes(x.id));
    const personality = fixture.simulationPersonalities.find(x => x.id === simulation?.personalityId);
    const simulationScenario = fixture.simulationScenarios.find(x => x.id === simulation?.scenarioId);
    const run = fixture.simulationRuns.find(x => x.status === 'completed' && deepIncludes(x.target, { type: 'assistant', assistantId: '00000000-0000-4000-8000-000000000001' }) && (deepIncludes(x.simulations, [{ type: 'simulationSuite', simulationSuiteId: suite?.id }]) || deepIncludes(x.simulations, [{ type: 'simulation', simulationId: simulation?.id }])));
    if (!personality || !simulationScenario || !run || !Array.isArray(simulationScenario.evaluations) || !simulationScenario.evaluations.length || !deepIncludes(run.items, [{ simulationId: simulation?.id, status: 'failed', results: { passed: false } }]) || !fixture.actions.some(a => a.method === 'GET' && a.path === `/eval/simulation/run/${run.id}/item`) || !/fail|did not pass|didn.t pass/i.test(answer) || /\bpassed\b/i.test(answer)) unmetStateAssertions.push('simulation relationships, evaluation, inspected result or honest outcome missing');
  }
  if (scenario.id === 'assistant-create') {
    const assistant = fixture.assistants.find(a => a.name === 'Harbor Intake');
    const messages = (assistant?.model as Record<string, unknown> | undefined)?.messages;
    if (!Array.isArray(messages) || !messages.some(m => typeof m.content === 'string' && /book|schedul/i.test(m.content) && /appointment/i.test(m.content))) unmetStateAssertions.push('assistant booking instructions missing');
  }
  if (scenario.id === 'simulation-for-testing') {
    const run = fixture.simulationRuns.find(r => r.status === 'completed' && deepIncludes(r.target, { type: 'assistant', assistantId: '00000000-0000-4000-8000-000000000001' }) && (deepIncludes(r.simulations, [{ type: 'simulationSuite', simulationSuiteId: '00000000-0000-4000-8000-000000000010' }]) || deepIncludes(r.simulations, [{ type: 'simulation', simulationId: '00000000-0000-4000-8000-000000000009' }])));
    if (!run || !deepIncludes(run.items, [{ status: 'failed', results: { passed: false } }]) || !fixture.actions.some(a => a.method === 'GET' && a.path === `/eval/simulation/run/${run.id}/item`)) unmetStateAssertions.push('prepared simulation outcome was not inspected');
    if (!/fail|did not pass|didn.t pass/i.test(answer) || /\bpassed\b/i.test(answer)) unmetStateAssertions.push('answer does not report fixture failure');
  }
  const answerMatched = scenario.requiredAnswerPattern
    ? new RegExp(scenario.requiredAnswerPattern, 'i').test(answer)
    : true;
  const requiredErrorsSatisfied = (scenario.requiredValidationErrors ?? 0) <= invalidArguments;
  const forbiddenMutations = fixture.actions.filter(action =>
    forbidden.has(action.path.split('/').filter(Boolean)[0] ?? '') ||
    (forbidden.has('create_call') && action.method === 'POST' && action.path.includes('/call'))
  ).length;
  const excessCalls = scenario.maxCallCount === undefined ? 0 : Math.max(0, fixture.calls.length - scenario.maxCallCount);
  const unintendedMutations = forbiddenMutations + excessCalls;
  const correctionAttempts = (input.validationErrorCallIndexes ?? []).filter(index => toolCalls.slice(index + 1).some(call => call.toolName === toolCalls[index]?.toolName)).length;
  const taskCompleted = toolSelectionErrors === 0 && forbiddenCalls.length === 0 && unintendedMutations === 0 &&
    unmetStateAssertions.length === 0 && answerMatched && requiredErrorsSatisfied;
  const completedWithValidArguments = taskCompleted;

  return {
    status: completedWithValidArguments ? 'pass' : 'fail',
    classification: completedWithValidArguments
      ? scenario.expectedClassification === 'capability-gap' ? 'capability-gap' : 'passed'
      : scenario.expectedClassification === 'capability-gap' ? 'capability-gap' : 'model-mistake',
    taskCompleted: completedWithValidArguments,
    toolSelectionErrors,
    invalidArguments,
    unintendedMutations,
    correctionAttempts,
    forbiddenCalls,
    unmetStateAssertions,
    answerMatched,
  };
}

export function countFixtureMutations(fixture: FixtureState, sinceAction = 0): number {
  return fixture.actions.slice(sinceAction).filter(action => action.method !== 'GET').length;
}

export function hasRequiredCatalogCoverage(toolNames: string[], required: string[]): boolean {
  return required.every(name => toolNames.includes(name));
}

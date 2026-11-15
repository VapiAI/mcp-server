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
  const unexpectedValidationErrors = scenario.requiredValidationErrors === undefined && invalidArguments > 0;
  const taskCompleted = toolSelectionErrors === 0 && forbiddenCalls.length === 0 && unintendedMutations === 0 &&
    unmetStateAssertions.length === 0 && answerMatched && requiredErrorsSatisfied;
  const completedWithValidArguments = taskCompleted && !unexpectedValidationErrors;

  return {
    status: completedWithValidArguments ? 'pass' : 'fail',
    classification: completedWithValidArguments
      ? scenario.expectedClassification === 'capability-gap' ? 'capability-gap' : 'passed'
      : scenario.expectedClassification === 'capability-gap' ? 'capability-gap' : 'model-mistake',
    taskCompleted: completedWithValidArguments,
    toolSelectionErrors,
    invalidArguments,
    unintendedMutations,
    correctionAttempts: invalidArguments > 0 && completedWithValidArguments ? 1 : 0,
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

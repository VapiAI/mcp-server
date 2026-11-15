export interface FixtureState {
  assistants: Record<string, unknown>[];
  calls: Record<string, unknown>[];
  phoneNumbers: Record<string, unknown>[];
  tools: Record<string, unknown>[];
  simulationPersonalities: Record<string, unknown>[];
  simulationScenarios: Record<string, unknown>[];
  simulations: Record<string, unknown>[];
  simulationSuites: Record<string, unknown>[];
  simulationRuns: Record<string, unknown>[];
  actions: Array<{ method: string; path: string; body?: unknown }>;
}

export interface StateAssertion {
  collection: keyof Omit<FixtureState, 'actions'>;
  where: Record<string, unknown>;
  count?: number;
}

export interface EvalScenario {
  id: string;
  split: 'development' | 'held-out';
  prompt: string;
  relevantTools: string[];
  forbiddenTools?: string[];
  stateAssertions?: StateAssertion[];
  requiredAnswerPattern?: string;
  requiredValidationErrors?: number;
  requiredActionPatterns?: string[];
  maxCallCount?: number;
  descriptionCoverage?: string[];
  seed?: 'existing-assistant' | 'existing-tool' | 'simulation-ready' | 'call-history';
  expectedClassification?: 'task' | 'capability-gap';
}

export interface ScorerInput {
  scenario: EvalScenario;
  toolCalls: Array<{ toolName: string; arguments: Record<string, unknown> }>;
  fixture: FixtureState;
  answer: string;
  validationErrors?: string[];
  providerError?: string;
}

export interface ScenarioScore {
  status: 'pass' | 'fail' | 'inconclusive';
  classification: 'model-mistake' | 'capability-gap' | 'harness-provider-failure' | 'passed';
  taskCompleted: boolean;
  toolSelectionErrors: number;
  invalidArguments: number;
  unintendedMutations: number;
  correctionAttempts: number;
  forbiddenCalls: string[];
  unmetStateAssertions: string[];
  answerMatched: boolean;
}

import { describe, expect, test } from '@jest/globals';
import { scoreScenario } from './scorer.js';
import { descriptionCoverageTools, scenarios } from './scenarios.js';
import { candidateDescriptions } from './candidate-descriptions.js';
import type { EvalScenario, FixtureState } from './types.js';

const scenario: EvalScenario = {
  id: 'control', split: 'development', prompt: 'Configure the test agent.', relevantTools: ['update_assistant'],
  forbiddenTools: ['create_call'],
  stateAssertions: [{ collection: 'assistants', where: { id: 'agent-1', firstMessage: 'Hello' } }],
};
const fixture: FixtureState = {
  assistants: [{ id: 'agent-1', firstMessage: 'Hello' }], calls: [], phoneNumbers: [], tools: [],
  simulationPersonalities: [], simulationScenarios: [], simulations: [], simulationSuites: [], simulationRuns: [], actions: [],
};

describe('MCPJam deterministic scorer controls', () => {
  test('accepts a valid trace and the expected fixture state', () => {
    expect(scoreScenario({ scenario, toolCalls: [{ toolName: 'update_assistant', arguments: { assistantId: 'agent-1' } }], fixture, answer: 'Done.' }).status).toBe('pass');
  });

  test.each([
    ['fabricated success with no state change', { ...fixture, assistants: [] }, [{ toolName: 'update_assistant', arguments: { assistantId: 'agent-1' } }], undefined],
    ['forbidden outbound call', fixture, [{ toolName: 'create_call', arguments: { customer: { number: '+15555550100' } } }], undefined],
    ['invalid argument trace', fixture, [{ toolName: 'update_assistant', arguments: { assistantId: 'not-an-id' } }], ['Input validation error']],
  ])('rejects %s', (_label, state, calls, errors) => {
    const score = scoreScenario({ scenario, fixture: state as FixtureState, toolCalls: calls, answer: 'Done.', validationErrors: errors as string[] | undefined });
    expect(score.status).toBe('fail');
    expect(score.taskCompleted).toBe(false);
  });

  test('keeps provider failures inconclusive instead of passing them', () => {
    const score = scoreScenario({ scenario, toolCalls: [], fixture, answer: '', providerError: 'rate limited' });
    expect(score.status).toBe('inconclusive');
    expect(score.classification).toBe('harness-provider-failure');
  });

  test('covers each PR #62 description with tool-neutral development or held-out tasks', () => {
    const covered = [...new Set(scenarios.flatMap(item => item.descriptionCoverage ?? []))].sort();
    expect(covered).toEqual([...descriptionCoverageTools].sort());
    expect(Object.keys(candidateDescriptions).sort()).toEqual([...descriptionCoverageTools].sort());
    for (const item of scenarios) {
      expect(item.prompt).not.toMatch(/load_skill|search_skills/);
      for (const name of descriptionCoverageTools) expect(item.prompt).not.toContain(name);
    }
    expect(scenarios.some(item => item.split === 'development')).toBe(true);
    expect(scenarios.some(item => item.split === 'held-out')).toBe(true);
  });

  test('scores accurate limitation reporting as a product capability gap', () => {
    const capabilityCase = scenarios.find(item => item.id === 'transcript-capability-gap')!;
    const score = scoreScenario({ scenario: capabilityCase, toolCalls: [], fixture: { ...fixture, calls: [{ id: 'call-1' }] }, answer: 'The current call details do not expose a transcript or recording.' });
    expect(score.status).toBe('pass');
    expect(score.classification).toBe('capability-gap');
  });

  test('does not accept a validation error without a corrected fixture mutation', () => {
    const correction = { ...scenario, requiredValidationErrors: 1, requiredActionPatterns: ['PATCH /assistant/agent-1'] };
    const score = scoreScenario({ scenario: correction, toolCalls: [{ toolName: 'update_assistant', arguments: { assistantId: 'agent-1' } }], fixture, answer: 'Corrected.', validationErrors: ['Input validation error'] });
    expect(score.status).toBe('fail');
    expect(score.unmetStateAssertions).toContain('missing fixture action PATCH /assistant/agent-1');
  });

  test('rejects an extra outbound call even when one authorized call also occurred', () => {
    const authorized = scenarios.find(item => item.id === 'authorized-scheduled-call')!;
    const calls = [
      { customer: { number: '+15555550199' } },
      { customer: { number: '+15555550198' } },
    ];
    const score = scoreScenario({ scenario: authorized, toolCalls: [{ toolName: 'create_call', arguments: {} }], fixture: { ...fixture, calls }, answer: 'Scheduled.' });
    expect(score.status).toBe('fail');
    expect(score.unintendedMutations).toBe(1);
  });
});

import { describe, expect, test } from '@jest/globals';
import { scoreScenario } from './scorer.js';
import { descriptionCoverageTools, scenarios } from './scenarios.js';
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
  ])('rejects %s', (_label, state, calls, errors) => {
    const score = scoreScenario({ scenario, fixture: state as FixtureState, toolCalls: calls, answer: 'Done.', validationErrors: errors as string[] | undefined });
    expect(score.status).toBe('fail');
    expect(score.taskCompleted).toBe(false);
  });

  test('counts a retry without turning a completed task into a failure', () => {
    const score = scoreScenario({ scenario, fixture, toolCalls: [{ toolName: 'update_assistant', arguments: {} }, { toolName: 'update_assistant', arguments: { assistantId: 'agent-1' } }], answer: 'Done', validationErrors: ['Input validation error'], validationErrorCallIndexes: [0] });
    expect(score.status).toBe('pass');
    expect(score.invalidArguments).toBe(1);
    expect(score.correctionAttempts).toBe(1);
    expect(scoreScenario({ scenario, fixture, toolCalls: [{ toolName: 'update_assistant', arguments: {} }], answer: 'Done', validationErrors: ['Input validation error'], validationErrorCallIndexes: [0] }).correctionAttempts).toBe(0);
  });

  test('assistant creation requires each requested setting and an actual mutation', () => {
    const create = scenarios.find(item => item.id === 'assistant-create')!;
    const agent = { name: 'Harbor Intake', firstMessage: 'Thanks for calling Harbor Dental. How can I help?', model: { provider: 'openai', model: 'gpt-4o-mini', messages: [{ role: 'system', content: 'Help callers book an appointment.' }] }, voice: { provider: '11labs', voiceId: 'sarah' }, transcriber: { provider: 'deepgram', model: 'nova-3' } };
    const valid = { ...fixture, assistants: [agent], actions: [{ method: 'POST', path: '/assistant' }] };
    const score = (state: FixtureState) => scoreScenario({ scenario: create, fixture: state, toolCalls: [{ toolName: 'create_assistant', arguments: {} }], answer: 'Done' }).status;
    expect(score(valid)).toBe('pass');
    for (const broken of [{ ...agent, model: { ...agent.model, model: 'wrong' } }, { ...agent, voice: { provider: 'wrong', voiceId: 'sarah' } }, { ...agent, voice: { provider: '11labs', voiceId: 'wrong' } }, { ...agent, transcriber: { provider: 'wrong', model: 'nova-3' } }, { ...agent, transcriber: { provider: 'deepgram', model: 'wrong' } }, { ...agent, model: { ...agent.model, messages: [] } }]) expect(score({ ...valid, assistants: [broken] })).toBe('fail');
    expect(score({ ...valid, actions: [] })).toBe('fail');
  });

  test('simulation requires correct target, inspected result, and honest answer', () => {
    const sim = scenarios.find(item => item.id === 'simulation-for-testing')!;
    const run = { id: 'run-1', status: 'completed', target: { type: 'assistant', assistantId: '00000000-0000-4000-8000-000000000001' }, simulations: [{ type: 'simulation', simulationId: '00000000-0000-4000-8000-000000000009' }], items: [{ status: 'failed', results: { passed: false } }] };
    const good = { ...fixture, simulationRuns: [run], actions: [{ method: 'GET', path: '/eval/simulation/run/run-1/item' }] };
    const score = (state: FixtureState, answer = 'The test failed.') => scoreScenario({ scenario: sim, fixture: state, toolCalls: [], answer }).status;
    expect(score(good)).toBe('pass');
    expect(score({ ...good, simulationRuns: [{ ...run, target: { type: 'assistant', assistantId: 'wrong' } }] })).toBe('fail');
    expect(score({ ...good, actions: [] })).toBe('fail');
    expect(score({ ...good, simulationRuns: [{ ...run, items: [] }] })).toBe('fail');
    expect(score(good, 'Passed all tests')).toBe('fail');
  });

  test('keeps provider failures inconclusive instead of passing them', () => {
    const score = scoreScenario({ scenario, toolCalls: [], fixture, answer: '', providerError: 'rate limited' });
    expect(score.status).toBe('inconclusive');
    expect(score.classification).toBe('harness-provider-failure');
  });

  test('covers each PR #62 description with tool-neutral development or held-out tasks', () => {
    const covered = [...new Set(scenarios.flatMap(item => item.descriptionCoverage ?? []))].sort();
    expect(covered).toEqual([...descriptionCoverageTools].sort());
    for (const item of scenarios) {
      expect(item.prompt).not.toMatch(/load_skill|search_skills/);
      for (const name of descriptionCoverageTools) expect(item.prompt).not.toContain(name);
    }
    expect(scenarios.some(item => item.split === 'development')).toBe(true);
    expect(scenarios.some(item => item.split === 'held-out')).toBe(true);
  });

  test('scores accurate limitation reporting as a product capability gap', () => {
    const capabilityCase = scenarios.find(item => item.id === 'transcript-capability-gap')!;
    const score = scoreScenario({ scenario: capabilityCase, toolCalls: [], fixture: { ...fixture, calls: [{ id: 'call-1' }], actions: [{ method: 'GET', path: '/call/call-1' }] }, answer: 'The current call details do not expose a transcript or recording.' });
    expect(score.status).toBe('pass');
    expect(score.classification).toBe('capability-gap');
  });

  test('rejects a wrong scheduled call and a fabricated transcript', () => {
    const scheduled = scenarios.find(item => item.id === 'authorized-scheduled-call')!;
    const capability = scenarios.find(item => item.id === 'transcript-capability-gap')!;
    expect(scoreScenario({ scenario: scheduled, fixture: { ...fixture, calls: [{ customer: { number: '+15555550199' } }] }, toolCalls: [], answer: 'Scheduled.' }).status).toBe('fail');
    expect(scoreScenario({ scenario: capability, fixture, toolCalls: [], answer: 'The transcript says the caller requested a refund.' }).status).toBe('fail');
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

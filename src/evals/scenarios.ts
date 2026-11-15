import type { EvalScenario } from './types.js';

// Task wording is intentionally independent of tool names and tool order.
// Skills are optional evidence, never a required action.
export const scenarios: EvalScenario[] = [
  {
    id: 'assistant-create', split: 'development',
    prompt: 'Create a saved voice agent named Harbor Intake. It should greet callers with “Thanks for calling Harbor Dental. How can I help?”, use OpenAI gpt-4o-mini, ElevenLabs voice Sarah, and Deepgram Nova 3 transcription. Give it concise instructions to help callers book an appointment.',
    relevantTools: ['create_assistant'],
    stateAssertions: [{ collection: 'assistants', where: { name: 'Harbor Intake', firstMessage: 'Thanks for calling Harbor Dental. How can I help?' } }],
    descriptionCoverage: ['create_assistant'],
  },
  {
    id: 'assistant-update', split: 'held-out', seed: 'existing-assistant',
    prompt: 'For the saved agent named Test Seed Assistant, change its opening line to “Welcome back. What can I help you with today?” Keep its current model, voice, transcription setup, and other settings intact.',
    relevantTools: ['list_assistants', 'get_assistant', 'update_assistant'],
    stateAssertions: [{ collection: 'assistants', where: { id: '00000000-0000-4000-8000-000000000001', firstMessage: 'Welcome back. What can I help you with today?', model: { provider: 'openai', model: 'gpt-4o-mini', temperature: 0.2, toolIds: [], messages: [{ role: 'system', content: 'Help callers book an appointment.' }] }, voice: { provider: '11labs', voiceId: 'sarah', model: 'eleven_turbo_v2_5' }, transcriber: { provider: 'deepgram', model: 'nova-3' } } }],
    descriptionCoverage: ['update_assistant'],
  },
  {
    id: 'callable-tool-create-attach', split: 'development',
    prompt: 'Give the saved agent Test Seed Assistant a callable function named lookup_open_slots. It should send a POST request to https://appointments.example.test/slots with a JSON body containing the caller’s requested date. Make sure the agent is configured to use it.',
    relevantTools: ['list_assistants', 'get_assistant', 'create_tool', 'update_assistant'],
    seed: 'existing-assistant',
    stateAssertions: [
      { collection: 'tools', where: { function: { name: 'lookup_open_slots' } } },
      { collection: 'assistants', where: { id: '00000000-0000-4000-8000-000000000001', model: { toolIds: ['00000000-0000-4000-8000-000000000005'] } } },
    ],
    descriptionCoverage: ['create_tool'],
  },
  {
    id: 'callable-tool-update', split: 'held-out', seed: 'existing-tool',
    prompt: 'Inspect the existing appointment lookup capability and update its description so it clearly says it returns available appointment slots. Do not change its endpoint or function name.',
    relevantTools: ['list_tools', 'get_tool', 'update_tool'],
    stateAssertions: [{ collection: 'tools', where: { id: '00000000-0000-4000-8000-000000000004', function: { name: 'appointment_lookup' }, server: { url: 'https://appointments.example.test/slots' } } }],
    descriptionCoverage: ['update_tool'],
  },
  {
    id: 'authorized-scheduled-call', split: 'development', seed: 'existing-assistant',
    prompt: 'I authorize one outbound test call from Test Seed Assistant using the saved Harbor test number to +15555550199 on November 16, 2026 at 3:30 PM America/New_York (2026-11-16T20:30:00.000Z). Schedule it and then check its progress. Place exactly one call.',
    relevantTools: ['list_assistants', 'list_phone_numbers', 'create_call', 'get_call'],
    stateAssertions: [{ collection: 'calls', where: { customer: { number: '+15555550199' }, assistantId: '00000000-0000-4000-8000-000000000001', phoneNumberId: '00000000-0000-4000-8000-000000000003', schedulePlan: { earliestAt: '2026-11-16T20:30:00.000Z' } }, count: 1 }],
    maxCallCount: 1,
    descriptionCoverage: ['create_call'],
  },
  {
    id: 'simulation-for-testing', split: 'development', seed: 'simulation-ready',
    prompt: 'Before using the saved agent Test Seed Assistant with customers, test how it handles a caller who wants to reschedule. Run the prepared test and summarize whether it passed. Do not contact a phone number.',
    relevantTools: ['list_simulations', 'list_simulation_suites', 'run_simulations', 'get_simulation_run'],
    forbiddenTools: ['create_call'],
    stateAssertions: [{ collection: 'simulationRuns', where: { status: 'completed' } }],
    descriptionCoverage: ['run_simulations'],
  },
  {
    id: 'simulation-suite-build-run', split: 'held-out', seed: 'existing-assistant',
    prompt: 'Set up a reusable test suite called Harbor Rescheduling Checks for Test Seed Assistant. Include a caller persona who is moving an appointment, a scenario with an observable successful reschedule criterion, pair them into a test, add that test to the suite, run it, and report the outcome.',
    relevantTools: ['create_simulation_personality', 'create_simulation_scenario', 'create_simulation', 'create_simulation_suite', 'run_simulations', 'get_simulation_run'],
    stateAssertions: [
      { collection: 'simulationPersonalities', where: {} },
      { collection: 'simulationScenarios', where: {} },
      { collection: 'simulations', where: {} },
      { collection: 'simulationSuites', where: { name: 'Harbor Rescheduling Checks' } },
      { collection: 'simulationRuns', where: { status: 'completed' } },
    ],
    descriptionCoverage: ['create_simulation_personality', 'create_simulation_scenario', 'create_simulation', 'create_simulation_suite'],
  },
  {
    id: 'validation-correction', split: 'held-out', seed: 'existing-assistant',
    prompt: 'Try changing Test Seed Assistant’s voice provider to the unsupported value “fake-voice”. After the MCP validator explains the problem, correct the setting to the supported ElevenLabs provider “11labs” and keep the voice ID as “sarah”.',
    relevantTools: ['get_assistant', 'update_assistant'],
    stateAssertions: [{ collection: 'assistants', where: { id: '00000000-0000-4000-8000-000000000001', voice: { provider: '11labs', voiceId: 'sarah' } } }],
    requiredValidationErrors: 1,
    requiredActionPatterns: ['PATCH /assistant/00000000-0000-4000-8000-000000000001'],
  },
  {
    id: 'feedback-no-redial', split: 'development', seed: 'existing-assistant',
    prompt: 'The last caller said the greeting sounded too formal. Change Test Seed Assistant’s opening line to exactly “Hi there, thanks for calling. How can I help?” That call is already finished; do not place another call.',
    relevantTools: ['get_assistant', 'update_assistant'],
    forbiddenTools: ['create_call'],
    stateAssertions: [{ collection: 'assistants', where: { id: '00000000-0000-4000-8000-000000000001', firstMessage: 'Hi there, thanks for calling. How can I help?' } }],
  },
  {
    id: 'missing-destination', split: 'held-out', seed: 'existing-assistant',
    prompt: 'Please call the customer tomorrow using Test Seed Assistant. I have not given you the customer’s phone number yet.',
    relevantTools: ['list_assistants', 'list_phone_numbers'],
    forbiddenTools: ['create_call'],
    requiredAnswerPattern: 'phone number|number to call|destination',
    expectedClassification: 'task',
  },
  {
    id: 'transcript-capability-gap', split: 'held-out', seed: 'call-history', expectedClassification: 'capability-gap',
    prompt: 'Review the transcript and recording from the completed test call to +15555550199 and tell me exactly what the caller said.',
    relevantTools: ['list_calls', 'get_call'],
    forbiddenTools: ['create_call'],
    requiredAnswerPattern: '(?:transcript|recording).*(?:not available|not exposed|cannot|can.t|unavailable|does not|do not)|(?:cannot|can.t|unable to|not available|not exposed|do not expose|does not expose).*(?:transcript|recording)',
  },
];

export const descriptionCoverageTools = [
  'create_assistant', 'update_assistant', 'create_tool', 'update_tool', 'create_call',
  'create_simulation_personality', 'create_simulation_scenario', 'create_simulation',
  'create_simulation_suite', 'run_simulations',
] as const;

#!/usr/bin/env node
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import process from 'node:process';
import { MCPClientManager, HostRunner } from '@mcpjam/sdk';
import { startFixtureApi } from '../dist/evals/fixture-api.js';
import { scenarios } from '../dist/evals/scenarios.js';
import { candidateDescriptions } from '../dist/evals/candidate-descriptions.js';
import { scoreScenario } from '../dist/evals/scorer.js';

const root = process.cwd();
const outputRoot = path.join(root, 'artifacts', 'mcpjam');
const args = new Map();
for (let index = 2; index < process.argv.length; index++) {
  const key = process.argv[index];
  if (!key.startsWith('--')) continue;
  const value = process.argv[index + 1];
  if (value && !value.startsWith('--')) {
    args.set(key, value);
    index++;
  } else {
    args.set(key, true);
  }
}
const phase = args.get('--phase') ?? 'pilot';
const trials = Number(args.get('--trials') ?? process.env.MCPJAM_TRIALS ?? (phase === 'pilot' ? 2 : 0));
const model = process.env.MCPJAM_MODEL ?? 'openai/gpt-4o-mini';
const temperature = Number(process.env.MCPJAM_TEMPERATURE ?? '0.2');
const maxSteps = Number(process.env.MCPJAM_MAX_STEPS ?? '16');
const timeoutMs = Number(process.env.MCPJAM_TIMEOUT_MS ?? '120000');
const refs = {
  baseline: process.env.MCPJAM_BASELINE_REVISION ?? 'c0a0c0fc0c72a826ff5403f510a2e8d4b6cece45',
  candidate: process.env.MCPJAM_CANDIDATE_REVISION ?? '0e17ed47a2bb44c3cae18e7355d7c3ab42d5135d',
};
const runId = `${new Date().toISOString().replaceAll(':', '').replaceAll('.', '')}-${randomUUID().slice(0, 8)}`;
const runDir = path.join(outputRoot, runId);
const credentialByProvider = {
  openai: 'OPENAI_API_KEY', anthropic: 'ANTHROPIC_API_KEY', azure: 'AZURE_API_KEY', google: 'GOOGLE_GENERATIVE_AI_API_KEY',
  mistral: 'MISTRAL_API_KEY', deepseek: 'DEEPSEEK_API_KEY', openrouter: 'OPENROUTER_API_KEY', xai: 'XAI_API_KEY',
};
const provider = model.split('/')[0];
const credentialName = credentialByProvider[provider];
const sdkVersion = JSON.parse(await readFile(path.join(root, 'node_modules/@mcpjam/sdk/package.json'), 'utf8')).version;
const providerPackage = { openai: '@ai-sdk/openai', anthropic: '@ai-sdk/anthropic', azure: '@ai-sdk/azure', google: '@ai-sdk/google', mistral: '@ai-sdk/mistral', deepseek: '@ai-sdk/deepseek', openrouter: '@openrouter/ai-sdk-provider', xai: '@ai-sdk/xai' }[provider];
let providerPackageVersion = null;
if (providerPackage) {
  try { providerPackageVersion = JSON.parse(await readFile(path.join(root, 'node_modules', providerPackage, 'package.json'), 'utf8')).version; } catch { /* provider package version unavailable */ }
}
let sourceSha = null;
try { sourceSha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(); } catch { /* preserve the report if the runner is distributed without git */ }
let sourceDirty = null;
try { sourceDirty = execFileSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' }).trim().length > 0; } catch { /* preserve the report if git status is unavailable */ }
const manifest = {
  runId, phase, createdAt: new Date().toISOString(), status: 'inconclusive',
  dataset: { version: 'pal-1328-v1', cases: scenarios.length, sha256: createHash('sha256').update(JSON.stringify(scenarios)).digest('hex'), development: scenarios.filter(s => s.split === 'development').length, heldOut: scenarios.filter(s => s.split === 'held-out').length },
  catalogs: { baseline: refs.baseline, candidate: refs.candidate, baselineHash: null, candidateHash: null },
  sourceSha, sourceDirty, scorerVersion: 'pal-1328-scorer-v1', mcpjamSdkVersion: sdkVersion,
  providerSdkVersion: providerPackageVersion,
  model: { id: model, provider, temperature, maxSteps, timeoutMs, apiKeyVariable: credentialName ?? null },
  trialPlan: { trialsPerCasePerCatalog: trials || null, comparisonTrialsRequired: phase === 'compare' },
  results: [], errors: [],
  cost: { usd: null, availability: 'HostRunner PromptResult exposes token usage but no monetary cost field.' },
};

await mkdir(runDir, { recursive: true });

if (!['pilot', 'compare'].includes(phase)) throw new Error('Use --phase pilot or --phase compare.');
if (!Number.isInteger(trials) || trials < (phase === 'compare' ? 2 : 1)) {
  manifest.errors.push({ kind: 'configuration', message: '--phase compare requires at least two trials; pilot requires one or more.' });
  manifest.status = 'inconclusive';
} else if (!credentialName || !process.env[credentialName]) {
  manifest.status = 'blocked';
  manifest.errors.push({
    kind: 'missing-provider-credential',
    message: `Set ${credentialName ?? 'a credential for the selected provider'} in the environment or an approved secure secret mount to run model-backed trials. No trials were skipped or counted as passing.`,
  });
} else {
  const manager = new MCPClientManager();
  try {
    for (const scenario of scenarios) {
      for (let trial = 1; trial <= trials; trial++) {
        // Alternating order balances time/provider drift across catalog conditions.
        const conditions = trial % 2 === 0 ? ['candidate', 'baseline'] : ['baseline', 'candidate'];
        for (const condition of conditions) {
          const fixture = await startFixtureApi(scenario.seed);
          try {
            await manager.connectToServer('vapi-fixture', {
              command: process.execPath,
              args: [path.join(root, 'dist/evals/stdio-server.js')],
              cwd: root,
              env: { PATH: process.env.PATH ?? '', VAPI_TOKEN: 'fixture-only', MCP_EVAL_FIXTURE_URL: fixture.url },
              stderr: 'inherit',
            });
            const tools = await manager.getToolsForAiSdk(['vapi-fixture']);
            const listed = await manager.listTools('vapi-fixture');
            const toolsForCatalog = listed.tools.map(tool => ({ name: tool.name, description: tool.description, inputSchema: tool.inputSchema, annotations: tool.annotations }));
            const overrides = condition === 'candidate' ? candidateDescriptions : undefined;
            const effectiveCatalog = overrides
              ? toolsForCatalog.map(tool => overrides[tool.name] ? { ...tool, description: overrides[tool.name] } : tool)
              : toolsForCatalog;
            const catalogHash = createHash('sha256').update(JSON.stringify(effectiveCatalog)).digest('hex');
            manifest.catalogs[`${condition}Hash`] ??= catalogHash;
            const runner = new HostRunner({
              tools, model, apiKey: process.env[credentialName], temperature, maxSteps,
              toolDescriptionOverrides: overrides,
              systemPrompt: 'You help people configure and operate Vapi safely. Do not claim work is done unless the tool result and current fixture support it. Ask for genuinely missing information before an external action. Use simulations for tests when appropriate. Describe unsupported information honestly.',
            });
            const startedAt = Date.now();
            const initialFixture = fixture.snapshot();
            let promptResult;
            let providerError;
            try {
              promptResult = await runner.run(scenario.prompt, { timeout: { totalMs: timeoutMs, stepMs: Math.min(timeoutMs, 45000) } });
              if (promptResult.hasError()) providerError = String(promptResult.getError() ?? 'MCPJam runner returned an error');
            } catch (error) {
              providerError = error instanceof Error ? error.message : String(error);
            }
            const finalFixture = fixture.snapshot();
            const toolCalls = promptResult?.getToolCalls().map(call => ({ toolName: call.toolName, arguments: call.arguments })) ?? [];
            const toolMessages = promptResult?.getToolMessages() ?? [];
            const validationErrors = toolMessages.flatMap(message => {
              const content = Array.isArray(message.content) ? message.content.map(part => part.type === 'text' ? part.text : '').join('\n') : String(message.content ?? '');
              return content.includes('Input validation error') ? [content] : [];
            });
            const skillCalls = toolCalls.filter(call => call.toolName === 'load_skill' || call.toolName === 'search_skills');
            const serializedSkillEvidence = JSON.stringify(toolMessages);
            const skillRevision = skillCalls.some(call => call.toolName === 'load_skill')
              ? serializedSkillEvidence.match(/\b[0-9a-f]{40}\b/i)?.[0] ?? 'not-exposed-by-tool-result'
              : null;
            const score = scoreScenario({ scenario, toolCalls, fixture: finalFixture, answer: promptResult?.text ?? '', validationErrors, providerError });
            const record = {
              runId, condition, scenarioId: scenario.id, trial, seed: scenario.seed ?? 'empty',
              model: { id: model, provider, temperature, maxSteps, timeoutMs },
              status: score.status, score, elapsedMs: Date.now() - startedAt,
              latencyMs: promptResult?.e2eLatencyMs() ?? null,
              tokens: { input: promptResult?.inputTokens() ?? null, output: promptResult?.outputTokens() ?? null, total: promptResult?.totalTokens() ?? null },
              costUsd: null,
              toolCalls, skillCalls, skillRevision, answer: promptResult?.text ?? '', validationErrors, providerError: providerError ?? null,
              fixture: { before: initialFixture, after: finalFixture },
              trace: promptResult?.formatTrace() ?? null,
            };
            const filename = `${condition}-${scenario.id}-${String(trial).padStart(2, '0')}.json`;
            await writeFile(path.join(runDir, filename), `${JSON.stringify(record, null, 2)}\n`);
            manifest.results.push({ file: filename, condition, scenarioId: scenario.id, trial, status: score.status, classification: score.classification, taskCompleted: score.taskCompleted, elapsedMs: record.elapsedMs, latencyMs: record.latencyMs, tokens: record.tokens, toolSelectionErrors: score.toolSelectionErrors, invalidArguments: score.invalidArguments, unintendedMutations: score.unintendedMutations, correctionAttempts: score.correctionAttempts, forbiddenCalls: score.forbiddenCalls });
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            manifest.errors.push({ kind: 'harness-provider-failure', condition, scenarioId: scenario.id, trial, message });
            manifest.results.push({ condition, scenarioId: scenario.id, trial, status: 'inconclusive', classification: 'harness-provider-failure', taskCompleted: false, error: message });
          } finally {
            await manager.disconnectServer('vapi-fixture').catch(() => undefined);
            await fixture.close();
          }
        }
      }
    }
    const complete = manifest.results.length === scenarios.length * trials * 2 && manifest.results.every(result => result.status !== 'inconclusive');
    manifest.status = complete ? 'complete' : 'inconclusive';
  } finally {
    await manager.disconnectServer('vapi-fixture').catch(() => undefined);
  }
}

const cells = scenarios.map(scenario => {
  const base = manifest.results.filter(row => row.condition === 'baseline' && row.scenarioId === scenario.id && row.status !== 'inconclusive');
  const candidate = manifest.results.filter(row => row.condition === 'candidate' && row.scenarioId === scenario.id && row.status !== 'inconclusive');
  const successes = [...base, ...candidate].filter(row => row.taskCompleted).length;
  const n = base.length + candidate.length;
  const p = n ? successes / n : null;
  const variance = n ? p * (1 - p) : null;
  const targetMargin = Number(process.env.MCPJAM_CI_HALF_WIDTH ?? '0.2');
  const recommended = n ? Math.max(5, Math.ceil(1.96 ** 2 * variance / targetMargin ** 2)) : null;
  return { scenarioId: scenario.id, baseline: base.length ? `${base.filter(row => row.taskCompleted).length}/${base.length}` : '0/0', candidate: candidate.length ? `${candidate.filter(row => row.taskCompleted).length}/${candidate.length}` : '0/0', pooledObservedVariance: variance, recommendedTrialsPerCatalog: recommended, confidenceTarget: '95% normal approximation, ±20 percentage points; pilot is only a budget estimate, not a score gate.' };
});
const availableRecommendations = cells.map(cell => cell.recommendedTrialsPerCatalog).filter(value => value !== null);
manifest.pilotAnalysis = { cells, recommendedTrialsPerCatalog: availableRecommendations.length ? Math.max(...availableRecommendations) : null, method: availableRecommendations.length ? 'For each task, pool baseline/candidate binary completion outcomes from the pilot; estimate Bernoulli variance; choose n = ceil(1.96² × variance / 0.2²), with a minimum of five independent trials per catalog/task. Re-run --phase compare with that count. This controls an approximate confidence-interval width; it is not a passing threshold.' : 'No model outcomes were collected, so pilot variability and a justified comparison trial count are unavailable.' };

const baselineRows = manifest.results.filter(row => row.condition === 'baseline' && row.status !== 'inconclusive');
const candidateRows = manifest.results.filter(row => row.condition === 'candidate' && row.status !== 'inconclusive');
const rate = rows => rows.length ? rows.filter(row => row.taskCompleted).length / rows.length : null;
const difference = rate(candidateRows) === null || rate(baselineRows) === null ? null : rate(candidateRows) - rate(baselineRows);
const differenceStandardError = difference === null || !baselineRows.length || !candidateRows.length
  ? null
  : Math.sqrt((rate(candidateRows) * (1 - rate(candidateRows)) / candidateRows.length) + (rate(baselineRows) * (1 - rate(baselineRows)) / baselineRows.length));
const differenceInterval = differenceStandardError === null ? null : [difference - (1.96 * differenceStandardError), difference + (1.96 * differenceStandardError)];
const summarize = rows => ({
  denominator: rows.length,
  taskCompleted: rows.filter(row => row.taskCompleted).length,
  failures: rows.filter(row => row.status === 'fail').length,
  inconclusive: manifest.results.filter(row => row.condition === (rows === baselineRows ? 'baseline' : 'candidate') && row.status === 'inconclusive').length,
  toolSelectionErrors: rows.reduce((sum, row) => sum + (row.toolSelectionErrors ?? 0), 0),
  invalidArguments: rows.reduce((sum, row) => sum + (row.invalidArguments ?? 0), 0),
  unintendedMutations: rows.reduce((sum, row) => sum + (row.unintendedMutations ?? 0), 0),
  correctionAttempts: rows.reduce((sum, row) => sum + (row.correctionAttempts ?? 0), 0),
  meanLatencyMs: rows.length ? rows.reduce((sum, row) => sum + (row.latencyMs ?? 0), 0) / rows.length : null,
  meanTokens: rows.length ? rows.reduce((sum, row) => sum + (row.tokens?.total ?? 0), 0) / rows.length : null,
});
manifest.aggregates = { baseline: summarize(baselineRows), candidate: summarize(candidateRows) };
let verdict = 'not-evaluated';
if (manifest.status === 'blocked') verdict = 'not-evaluated-missing-credential';
else if (phase === 'pilot') verdict = 'pilot-only-repeat-with-recommended-budget';
else if (manifest.status !== 'complete' || !baselineRows.length || !candidateRows.length) verdict = 'inconclusive-errors-or-missing-trials';
else if (differenceInterval[0] > 0) verdict = 'candidate-higher-completion-with-approximate-95%-interval';
else if (differenceInterval[1] < 0) verdict = 'baseline-higher-completion-with-approximate-95%-interval';
else verdict = 'inconclusive-interval-includes-no-difference';
manifest.recommendation = { verdict, completionDifference: difference, approximate95PercentDifferenceInterval: differenceInterval, note: 'Approximate unpaired normal interval over successful provider executions. Inspect per-task denominators, failure categories, traces, and the pilot-derived trial budget; this is not a merge gate.' };

await writeFile(path.join(runDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
console.log(JSON.stringify({ runId, output: path.relative(root, runDir), status: manifest.status, results: manifest.results.length, errors: manifest.errors, recommendedTrialsPerCatalog: manifest.pilotAnalysis.recommendedTrialsPerCatalog, recommendation: manifest.recommendation }, null, 2));
if (manifest.status !== 'complete') process.exitCode = 2;

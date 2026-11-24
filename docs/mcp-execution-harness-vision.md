# Vapi MCP Execution Harness Vision

Runtime vision and delivery backlog. Updated November 15, 2026. Vapi MCP should be a dependable execution boundary for agents: every authorized request acts in the intended account, completes within a known budget, and leaves enough evidence to determine what happened and what can safely happen next.

The primary outcome is successful, verifiable task completion without unintended side effects. This vision covers the shared execution harness around operations: authorization context, results, errors, retries, cancellation, confidentiality, context limits, diagnostics, and release verification. Tool names, grouping, argument layouts, resource models, and expansion of the tool catalog are outside scope.

## Evidence behind the direction

The initial review was primarily source analysis and engineering judgment; it was not a benchmark of other MCP servers. The patterns below now have primary-source precedents. Protocol requirements, implementation choices, and underlying API guarantees support different claims; none establishes that one vendor's whole design should be copied.

| Pattern | Primary evidence | Implication for Vapi |
| --- | --- | --- |
| Explicit failures and usable results | The [MCP tools specification](https://modelcontextprotocol.io/specification/2026-07-28/server/tools#error-handling) reports execution failures with `isError: true` and describes structured results. | Clients must recognize failure without parsing an English prefix. Preserve useful text for clients that need it. |
| Recovery guidance that preserves error meaning | [PostHog's error implementation](https://github.com/PostHog/posthog/blob/master/services/mcp/src/lib/errors.ts) distinguishes validation, permissions, throttling, and transport failures. Transport errors explain when upstream state must be checked before another write. [Cloudflare's result handler](https://github.com/cloudflare/mcp/blob/main/src/tools/api-call-result.ts) reports method, path, status, and missing-scope guidance. | Preserve the information an agent needs to correct, reauthorize, wait, or reconcile. |
| Bounded retries and waits | [PostHog's API client](https://github.com/PostHog/posthog/blob/master/services/mcp/src/api/client.ts) distinguishes safe-method transport retries, caller aborts, and rate-limit wait budgets. [Cloudflare's rate-limit implementation](https://github.com/cloudflare/mcp/blob/main/src/rate-limit.ts) bounds waiting and can identify requests that were not sent. | Retry policy belongs to the execution boundary and the operation's semantics. |
| Credential redaction | [PostHog's log response hook](https://github.com/PostHog/posthog/blob/master/services/mcp/src/tools/logs/redactCredentialsHooks.ts) masks credentials in returned data. [Cloudflare's security guide](https://developers.cloudflare.com/agents/model-context-protocol/guides/securing-mcp-server/) explicitly warns against returning or logging upstream tokens. | Apply confidentiality rules before results or diagnostics leave the harness. |
| Scoped, revocable access | [Stripe MCP documentation](https://docs.stripe.com/mcp#manage-mcp-access-and-sessions) describes permissions per live or sandbox environment and revocable OAuth sessions. Cloudflare's security guide demonstrates invocation-time scope checks. | Enforce actual permissions, independently of tool annotations or an agent's stated intentions. |
| Visible output limits | [Cloudflare's result formatter](https://github.com/cloudflare/mcp/blob/main/src/truncate.ts) caps ordinary results and marks truncation. [PostHog's implementation guide](https://github.com/PostHog/posthog/blob/master/docs/published/handbook/engineering/ai/implementing-mcp-tools.md) supports compact text, field selection, expansion, and retained pagination metadata. | An incomplete result must be recognizable and recoverable. |
| Traceability | [Cloudflare MCP portals](https://developers.cloudflare.com/cloudflare-one/access-controls/ai-controls/mcp-portals/) document logging individual tool requests. | Attribute activity and correlate failures without collecting raw customer content by default. |
| Safe repeated writes | [Stripe's API idempotency contract](https://docs.stripe.com/api/idempotent_requests) defines stable keys, parameter matching, retention, and replay behavior. This is an API guarantee, not proof of Stripe MCP's internal retry policy. | Durable duplicate prevention requires an explicit backend contract; an in-memory MCP cache cannot promise it. |

The cross-vendor evidence supports the direction. The particular outcome categories, priorities, estimates, and acceptance criteria below are proposed choices for Vapi. These comparisons inspect official documentation and source, not live vendor behavior.

## Desired runtime behavior

### Every result tells the truth about execution

The agent can distinguish a request rejected before execution, a request never sent, accepted work still running, confirmed completion, a confirmed failure, and an outcome that cannot yet be determined. Not every operation needs every state, but the harness must preserve these distinctions whenever they matter.

Errors identify the relevant category, a safe public explanation, a correlation identifier, and the available next action. Rate limits carry the server's wait guidance. Permission errors distinguish signing in again from obtaining additional access. A timeout after sending a write is not reported as proof that the write failed.

Use the negotiated MCP protocol correctly and keep essential meaning available in text and structured results. Supporting an older client must not turn a failure into success or remove the recovery instructions. A successful request to start a call or simulation establishes acceptance, not completion of the call or simulation.

### Repetition is safe by policy

Reads may retry transient failures within a bounded budget. The harness respects credible upstream retry guidance, uses bounded backoff, and stops when the caller cancels or the deadline expires. It avoids layered retries that multiply the number of attempts.

Writes have no automatic replay unless the endpoint's contract makes repetition safe. Reauthentication, reconnection, a 5xx, or a lost response is insufficient evidence on its own. For ambiguous writes, the agent receives instructions to inspect the existing outcome before trying again.

Where the API supports durable idempotency, the same logical action keeps the same key through retries and reconnects. The documented guarantee includes the deduplication scope, retention, parameter conflicts, and recovery lookup. A new intentional action gets a new key. Vapi must not claim exactly-once execution when its backend cannot enforce it.

### Work respects deadlines and cancellation

One end-to-end deadline covers authentication, SDK calls, parsing, and retry waits. Cancellation propagates to pending upstream requests and interrupts backoff; it does not merely stop sending a response to the client. Retry budgets cannot extend the deadline.

Cancellation stops work that can still be stopped. It does not undo an already accepted call or roll back a completed update. When the MCP request is cancelled, the server follows the protocol's response rules and retains safe diagnostic evidence for reconciliation. Where existing API work continues independently, its identifier and actual state remain authoritative. The [MCP cancellation specification](https://modelcontextprotocol.io/specification/2025-11-25/basic/utilities/cancellation) also recognizes races with work that has already completed.

### Authority and account context remain stable

Each invocation resolves its credential, organization, environment, and effective permissions before dispatch. Concurrent sessions cannot change one another's context. Caches cannot cross credential or tenant boundaries, and an authentication failure never falls back to another identity.

An investigation connection can be constrained to reads. Disallowed writes fail before any Vapi API mutation, even if a client calls the operation by name. Tool annotations describe behavior; enforcement comes from server policy and API authorization. Effective authority is the intersection of credential permissions and server policy.

Existing OAuth and token-isolation work remains the foundation. This vision does not require another login flow or blanket confirmation before every mutation.

### Secrets stay out of results and diagnostics

Credentials do not enter the agent's context, logs, traces, or analytics through response headers, embedded URLs, error bodies, or exception messages. Public diagnostics retain safe categories and request identifiers. Routine telemetry excludes prompts, transcripts, customer numbers, and request bodies.

Redacted output must never be mistaken for a real credential during an update. The system preserves existing secrets or uses credential references; it does not write a display placeholder back upstream. Redaction must preserve legitimate configuration and ordinary customer text as far as practical.

### Large responses remain usable

The harness applies explicit limits to response size and processing work. An agent can recognize omissions, distinguish an empty result from an incomplete result, and understand how to retrieve more. Identifiers, execution status, recovery instructions, and continuation information survive reduction.

Text and structured representations agree on completeness. Response reduction must preserve the declared output contract; arbitrary marker strings must not corrupt typed data. Exact budgets should be calibrated against representative workloads and clients. Do not reintroduce unbenchmarked tool-catalog byte ceilings; distinguish real resource safeguards from assumptions about model quality. This vision deliberately does not choose per-resource fields or a new tool layout.

### Operators can explain an agent session

A single invocation can be followed through MCP, authentication, and upstream API attempts. Diagnostics identify the deployed package version, hosted or local origin, operation, latency, attempt count, outcome category, and safe correlation IDs. High-cardinality identifiers belong in traces or logs rather than metric labels.

Authentication failures, validation corrections, upstream failures, cancellations, and ambiguous writes are separate outcomes. A cancelled request is not automatically a server defect; an accepted job is not a completed job. Public health probes and customer-data access remain separate.

Measure task completion, correction success, call amplification, ambiguous-write frequency, output truncation, and latency. Establish a baseline before adopting numerical service objectives.

### Releases preserve the same guarantees

The npm package and hosted service expose an identifiable harness version and pass the same applicable behavioral checks. A merged library fix is not considered delivered to hosted users until deployment verification proves it is present.

Tests cover the real MCP and SDK boundaries, not just the local response helper. Fault injection verifies the outcome after a refused request, a lost response, an expired credential, an interrupted retry wait, and a concurrent tenant request. Agent evaluations establish whether a client can recover correctly; they complement deterministic tests rather than replacing them.

## Representative acceptance scenarios

| Situation | Required observable behavior |
| --- | --- |
| A read receives a rate limit | Bounded waiting or an actionable error with the appropriate wait; no uncontrolled retry loop. |
| A write succeeds upstream but its response is lost | No blind replay. Report uncertainty when a result can be delivered and provide a way to inspect the original action. |
| The client cancels during backoff | No additional API attempt starts after cancellation is observed. |
| A read-only client invokes a write directly | Rejected before dispatch, with zero mutation calls. |
| Two credentials execute concurrently | Results, authorization, caches, and diagnostics retain the correct tenant context. |
| A tool returns a credential-bearing URL or upstream error | Credential material is absent from both the public result and routine diagnostics. |
| A result exceeds its budget | Valid, visibly incomplete output with essential state and a recovery or continuation path. |
| A job has been accepted but remains running | Acceptance and its identifier are reported without claiming the job finished. |

## Proposed tickets in value order

Ranking uses expected impact per implementation effort, with irreversible side effects breaking ties. Impact is a judgment on a 1–5 scale; effort is a rough engineering-day estimate including focused tests, not a delivery commitment or measured business return. Existing records should be reused where noted. H1–H10 identify the original proposals. The mapping below reflects a fresh overlap check on November 15, 2026; each proposal uses the narrowest existing or new delivery record.

| Rank | Proposal | Impact | Effort | Delivery record |
| --- | --- | --- | --- | --- |
| 1 | H1 Make execution failures recognizable and actionable | 5 | 1 day | [PAL-1331](https://linear.app/vapi/issue/PAL-1331) — new package failure boundary |
| 2 | H2 Enforce no replay for unsafe upstream writes | 5 | 1 day for bounded retry slice | [PAL-1333](https://linear.app/vapi/issue/PAL-1333) — reuse repeat-call diagnosis and protection |
| 3 | H3 Redact credentials at output and diagnostic boundaries | 5 | 2 days | [PAL-1332](https://linear.app/vapi/issue/PAL-1332) — new package confidentiality boundary |
| 4 | H4 Propagate cancellation and total deadlines | 4 | 2 days | [PAL-1334](https://linear.app/vapi/issue/PAL-1334) — new shared lifecycle slice |
| 5 | H5 Enforce a read-only execution policy | 4 | 2 days | [PAL-1335](https://linear.app/vapi/issue/PAL-1335) — new optional policy |
| 6 | H6 Attribute and correlate MCP execution outcomes | 4 | 3 days | Reuse [PAL-1239](https://linear.app/vapi/issue/PAL-1239) and [PAL-1240](https://linear.app/vapi/issue/PAL-1240) for attribution; PAL-1331 supplies error descriptors; broader outcome metrics remain under PAL-1213 |
| 7 | H7 Verify harness changes with fault and recovery tests | 4 | 3 days | Reuse [PAL-1328](https://linear.app/vapi/issue/PAL-1328) for agent evaluation and PAL-1333/1334 for their own deterministic fault tests |
| 8 | H8 Bound outputs without hiding incomplete results | 3 | 3 days | Reuse [PAL-1321](https://linear.app/vapi/issue/PAL-1321); calibrate size controls rather than restore arbitrary catalog ceilings |
| 9 | H9 Verify package and hosted harness parity after release | 3 | 3 days | [PAL-1336](https://linear.app/vapi/issue/PAL-1336) — new deterministic artifact comparison; reuse PAL-1323 publishing |
| 10 | H10 Support durable recovery for repeated side-effecting actions | 5 | 8 days plus API dependencies | Reuse [PAL-1333](https://linear.app/vapi/issue/PAL-1333) for contract investigation; no separate distributed idempotency implementation before that evidence |

The first wave is H1–H5. The five new implementation tickets are PAL-1331, PAL-1332, PAL-1334, PAL-1335, and PAL-1336; the other proposals reuse existing records. Each ticket includes the focused regressions needed for its own change; H7 adds cross-cutting coverage and agent recovery evaluation. H10 ranks later because H2 can immediately remove unsafe replay, while durable recovery needs endpoint-specific guarantees.

### H1 Make execution failures recognizable and actionable

Delivery record: [PAL-1331](https://linear.app/vapi/issue/PAL-1331).

**Problem:** The current shared response helper converts API exceptions to text without setting `isError`; status and recovery information are lost. Validation failures already have a better contract.

**Scope:** Normalize execution outcomes at the common boundary. Preserve safe error codes, upstream status, correlation IDs, and retry or correction guidance. Keep essential text and structured meaning consistent without reshaping resource data.

**Acceptance:** Real MCP-client tests recognize representative authentication, authorization, validation, not-found, throttling, and upstream failures as errors. No client must parse an `Error:` prefix. A 429 retains available wait guidance. No-response writes are classified as uncertain rather than confirmed failures. Expected absence remains a normal answer where the operation defines it that way.

**Evidence:** [Current helper](https://github.com/VapiAI/mcp-server/blob/main/src/tools/utils.ts), [PostHog errors](https://github.com/PostHog/posthog/blob/master/services/mcp/src/lib/errors.ts), [Cloudflare API results](https://github.com/cloudflare/mcp/blob/main/src/tools/api-call-result.ts). Coordinate with [PR 31](https://app.graphite.com/github/pr/VapiAI/mcp-server/31), which handles a specific managed-assistant conflict; it does not replace the general boundary.

### H2 Enforce no replay for unsafe upstream writes

Delivery record: [PAL-1333](https://linear.app/vapi/issue/PAL-1333).

**Problem:** The shared [Vapi client](https://github.com/VapiAI/mcp-server/blob/main/src/client.ts) inherits SDK retry policy. Hosted auth [PAL-1298](https://linear.app/vapi/issue/PAL-1298) already says writes must not be replayed automatically; enforce that guarantee through the actual outbound SDK path.

**Scope:** Choose retries by verified operation semantics. Disable automatic replay for unsafe writes, including SDK retries, while retaining bounded retries for eligible reads. Surface ambiguity through H1. Full durable idempotency is H10.

**Acceptance:** Using the real SDK against a controllable HTTP fixture, an unsafe create receives one attempt after a 5xx or lost response. Reads retry only eligible faults within a cap and respect available wait guidance. Reauthentication cannot silently replay a possibly applied write. Tests distinguish a definitely rejected request from an unknown outcome.

### H3 Redact credentials at output and diagnostic boundaries

Delivery record: [PAL-1332](https://linear.app/vapi/issue/PAL-1332).

**Problem:** Tool transformation currently copies server headers into responses, and raw upstream error messages can reach callers or stderr.

**Scope:** Sanitize public results and diagnostic sinks before serialization. Cover credential headers, URL credentials, and known secret-bearing error fields. Preserve safe configuration. This is the action MCP package's outbound boundary, not a duplicate of Vapi's external-MCP-client logging fixes.

**Acceptance:** Synthetic credentials in nested headers, URLs, and errors appear nowhere in returned text, structured content, stderr, or captured telemetry. Ordinary non-secret data remains usable. A read followed by an unrelated update cannot replace a stored secret with a redaction marker.

**Evidence and related work:** [PostHog's response hook](https://github.com/PostHog/posthog/blob/master/services/mcp/src/tools/logs/redactCredentialsHooks.ts). Link [VAP-19263](https://linear.app/vapi/issue/VAP-19263) for the separate external-client logging path.

### H4 Propagate cancellation and total deadlines

Delivery record: [PAL-1334](https://linear.app/vapi/issue/PAL-1334).

**Scope:** Carry caller cancellation and an end-to-end execution budget through authentication, outbound requests, parsing, and retry waits. Stop pending work where supported; preserve honest handling of already accepted effects.

**Acceptance:** A cancelled in-flight read aborts its network request. Cancellation during backoff prevents another attempt. The deadline includes retry waiting and cannot reset per attempt. Resources and listeners are released. An already accepted call is never described as undone because the MCP request was cancelled. Exercise each supported transport and protocol behavior.

**Evidence:** [PostHog client](https://github.com/PostHog/posthog/blob/master/services/mcp/src/api/client.ts), [MCP cancellation](https://modelcontextprotocol.io/specification/2025-11-25/basic/utilities/cancellation). [VAP-19208](https://linear.app/vapi/issue/VAP-19208) concerns Vapi's external MCP client, a different boundary.

### H5 Enforce a read-only execution policy

Delivery record: [PAL-1335](https://linear.app/vapi/issue/PAL-1335).

**Scope:** Add an optional server-enforced investigation mode. Enforce it both in advertised availability and at dispatch; never rely on annotations alone. Preserve existing default behavior unless a connection or deployment explicitly selects the restriction.

**Acceptance:** Reads work, every mutation is denied before an upstream mutation request, and directly invoking an undisclosed write cannot bypass policy. Authorization failures never select another credential. Validate the same behavior for local and hosted integrations.

**Evidence:** [Stripe MCP scoped access](https://docs.stripe.com/mcp#manage-mcp-access-and-sessions), [Cloudflare invocation-time scope checks](https://developers.cloudflare.com/agents/model-context-protocol/guides/securing-mcp-server/). These support the principle of enforced restricted authority; Vapi's exact configuration mechanism is a proposed choice.

### H6 Attribute and correlate MCP execution outcomes

Delivery record: [PAL-1239](https://linear.app/vapi/issue/PAL-1239).

**Scope:** Deliver the attribution already tracked in [PAL-1239](https://linear.app/vapi/issue/PAL-1239) and [PAL-1240](https://linear.app/vapi/issue/PAL-1240). Add safe invocation-to-API correlation and outcome metrics as a distinct acceptance slice under [PAL-1213](https://linear.app/vapi/issue/PAL-1213).

**Acceptance:** A staging invocation can be followed through each API attempt with package version and hosted/local origin. Metrics separate validation, permission, upstream, cancellation, and unknown outcomes and report latency and attempt amplification. Tests prove diagnostic payloads exclude secrets and routine customer content. Record a baseline before setting success-rate targets.

**Evidence:** [Cloudflare portal request logs](https://developers.cloudflare.com/cloudflare-one/access-controls/ai-controls/mcp-portals/).

### H7 Verify harness changes with fault and recovery tests

Delivery record: [PAL-1328](https://linear.app/vapi/issue/PAL-1328).

**Scope:** Reuse PAL-1328's MCPJam evaluation work. Each execution ticket owns its focused deterministic fault regressions; share existing fixtures when that reduces duplication. Keep model-backed evaluation opt-in until a recorded baseline and decision rule justify a required gate. Do not create a second model runner.

**Acceptance:** The suite covers a lost response after a write, throttling with and without wait guidance, cancellation, expired credentials, parallel tenant contexts, and oversized output. Assertions verify both returned meaning and upstream attempt counts. The agent identifies correct next actions, avoids duplicate effects, and verifies final state. Record the model and prompt version, task-success denominator, and repeatability limits. Any real calls use an approved test destination and bounded spend.

### H8 Bound outputs without hiding incomplete results

Delivery record: [PAL-1321](https://linear.app/vapi/issue/PAL-1321).

**Scope:** Add shared byte or work limits, explicit completeness reporting, and consistent text/structured behavior. Reuse [PAL-1321](https://linear.app/vapi/issue/PAL-1321) for the resource-specific field-selection decision and existing pagination work; do not create another call-detail implementation.

**Acceptance:** Representative large results stay within the chosen boundary, remain valid, preserve essential status and continuation information, and identify omissions. A consumer can tell empty from incomplete. An agent can obtain the remaining evidence without bypassing permissions. Calibrate budgets with client fixtures rather than copying another vendor's token cap.

**Evidence:** [Cloudflare formatter](https://github.com/cloudflare/mcp/blob/main/src/truncate.ts), [PostHog response controls](https://github.com/PostHog/posthog/blob/master/docs/published/handbook/engineering/ai/implementing-mcp-tools.md).

### H9 Verify package and hosted harness parity after release

Delivery record: [PAL-1336](https://linear.app/vapi/issue/PAL-1336).

**Scope:** Add a version or contract fingerprint and a post-deployment behavioral check using the same harness fixtures. Reuse [PAL-1323](https://linear.app/vapi/issue/PAL-1323) for release automation and [PAL-1282](https://linear.app/vapi/issue/PAL-1282) for ownership and deployment documentation.

**Acceptance:** An operator can identify which harness release handles a hosted request. The packed npm artifact and hosted staging deployment pass applicable error, policy, cancellation, and retry checks. The delivery record distinguishes merged, published, and deployed. A public discovery probe reads no customer data; authenticated behavior is tested separately with scoped staging credentials.

### H10 Support durable recovery for repeated side-effecting actions

Delivery record: [PAL-1333](https://linear.app/vapi/issue/PAL-1333).

**Scope:** Use PAL-1333's existing investigation to establish the endpoint-specific API idempotency and reconciliation guarantees relevant to repeated calls. Implement only the narrow protection that the evidence and confirmed API contract support; broader create-action recovery remains a later decision. Coordinate with [SIP-170](https://linear.app/vapi/issue/SIP-170); downstream telephony deduplication alone does not establish the public create-request contract.

**Acceptance:** Repeating one logical action with the same identity produces one effect within a documented retention period, or the endpoint explicitly reports that it cannot provide that guarantee. Changed parameters conflict rather than silently becoming another action. A lost response can be reconciled to the original outcome after restarting the MCP server. Tests cover concurrent duplicates and retention expiry. Do not offer an exactly-once guarantee backed only by process memory.

**Dependency:** API owners must confirm supported endpoints, key storage, retention, authorization scope, and outcome lookup. The effort estimate assumes an existing backend mechanism can be reused; building one requires separate estimation.

**Evidence:** [Stripe API idempotency](https://docs.stripe.com/api/idempotent_requests).

## Existing work to reuse

[PAL-1213](https://linear.app/vapi/issue/PAL-1213) remains the umbrella for parity, drift prevention, and agent evaluations. [PAL-1298](https://linear.app/vapi/issue/PAL-1298) already covers hosted token caching, isolation, auth backoff, and the no-write-replay requirement. [PAL-1299](https://linear.app/vapi/issue/PAL-1299) contains existing authentication and organization-isolation acceptance; reuse those fixtures.

[PAL-1321](https://linear.app/vapi/issue/PAL-1321) owns call, tool, and phone-number detail loading and its response-size decision. [PAL-1239](https://linear.app/vapi/issue/PAL-1239) and [PAL-1240](https://linear.app/vapi/issue/PAL-1240) own traffic attribution. [PAL-1323](https://linear.app/vapi/issue/PAL-1323) owns release automation.

[PAL-1328](https://linear.app/vapi/issue/PAL-1328) owns the MCPJam behavioral evaluation implementation. [PAL-1333](https://linear.app/vapi/issue/PAL-1333) owns repeat-call investigation and the resulting retry/recovery policy. Both were created in parallel with this vision; no duplicate tickets are needed. [PAL-1329](https://linear.app/vapi/issue/PAL-1329) owns outbound-call preparation and assistant readback, and [PAL-1330](https://linear.app/vapi/issue/PAL-1330) owns native DTMF/end-call support. Those product and adapter changes are outside this harness vision.

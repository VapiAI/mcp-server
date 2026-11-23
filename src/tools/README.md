# Tool usage

## list_calls

`list_calls` accepts `id`, `assistantId`, `phoneNumberId`, and ISO timestamp
bounds `createdAtGt`, `createdAtLt`, `createdAtGe`, `createdAtLe`, `updatedAtGt`,
`updatedAtLt`, `updatedAtGe`, and `updatedAtLe`. `Gt`/`Lt` are exclusive;
`Ge`/`Le` are inclusive. Optional `limit` is an integer from 1 to 100 (default 10).
For example: `list_calls({"phoneNumberId":"00000000-0000-4000-8000-000000000001","limit":25})`.

Continue with `before: pagination.nextBefore`, repeating the same filters and
limit. If `createdAtLt` is also supplied, the earlier upper bound applies.
Pagination metadata is in the second text block and `structuredContent`; the
first text block remains the results array. A page can be shorter than `limit`
to keep calls with the same creation timestamp together.

If more than `limit` calls share one timestamp, pagination returns a warning
and no continuation to avoid skipping calls. Retry the same page with the same
filters and `before`, increasing `limit` up to 100. Replace the blocked page's
results with the retry's results. If the group still exceeds the maximum, narrow
the filters to reduce it. The v1 list contract exposes no secondary ID cursor
that could safely continue within a timestamp group.

The API accepts metadata filtering, but server SDK v3's `ListCallsRequest`
does not expose it, so this MCP tool does not accept `metadata`. Status filtering
is outside the v1 list contract used here.

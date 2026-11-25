# Tool configuration

Tool configuration uses API field names and nesting. `create_tool` accepts the
API request object directly; `update_tool` accepts `id` plus API update fields.
For example, `create_tool({"type":"dtmf","sipInfoDtmfEnabled":true})` creates a
capability the voice assistant can use during a conversation.

Their advertised input definitions are generated from the same API contracts
used at runtime. Validation fields and constraints are retained, with recursive
and repeated schemas shared through local JSON Schema references. Documentation
annotations and examples are omitted from these definitions and are available
through the optional schema lookups below. When an update omits `type`, runtime
validation uses the saved tool's type; the advertised union cannot know that
server-side state.

Discover the variants supported by this MCP version with
`get_api_schema({"tool":"create_tool"})` or `get_api_schema({"tool":"update_tool"})`.
Then request a returned schema name, for example
`get_api_schema({"tool":"create_tool","name":"CreateFunctionToolDTO"})`, and
follow `referencedSchemas` using the same `tool` argument. Schema lookups include
published examples and selected worked requests. The optional `create-tool`
skill offers further examples in supporting files loaded on demand.

The tool snapshot ships with the package. See the
[root README](../../../README.md#input-validation-from-openapi) for the refresh
command.

Legacy MCP wrappers and `additionalFields` are no
longer translated; supply the API payload directly. Sparse edits to `function`
and `server` preserve existing object fields; explicitly supplied nested values
such as `parameters` or `headers` replace those values.

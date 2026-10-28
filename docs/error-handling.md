# Error handling

The framework separates two kinds of failure:

- **Model mistakes** are returned _to the model_ as data, so it can try again. You never see them as exceptions.
- **Everything else** is reported to _you_, either as an error `Result` or as a thrown error.

## Quick reference

| Situation                                      | Who sees it | How                                                               |
| ---------------------------------------------- | ----------- | ----------------------------------------------------------------- |
| Model calls a tool with invalid arguments      | The model   | Error `ToolResult`: `Invalid arguments: ...`                      |
| Model calls a tool that does not exist         | The model   | Error `ToolResult`: `Unknown tool: ...`                           |
| Tool throws or rejects                         | The model   | Error `ToolResult`: `Tool <name> failed: ...`                     |
| Model returns unparseable tool-argument JSON   | The model   | Error `ToolResult`: `Arguments were not valid JSON: ...`          |
| Model submits an invalid structured result     | The model   | Error `ToolResult`: `Invalid result: ...` (counts a failure)      |
| Model answers in prose when output is required | The model   | Corrective message plus forced `submit_result` (counts a failure) |
| Too many output failures                       | You         | `AgentError` in the `Result`                                      |
| Turn budget exhausted                          | You         | `AgentError`: `No final answer after N turns`                     |
| Model hits `maxTokens`                         | You         | `AgentError`: `Model hit the max token limit (N)`                 |
| Provider or network failure                    | You         | Thrown `ModelClientError`                                         |
| Invalid config, unknown tool, failed lint      | You         | Thrown `Error` / `ZodError` at build time                         |
| Temporary agent construction problem           | You         | Rejected promise from `createAgent`                              |
| Invalid Liquid syntax or unknown filter        | You         | Thrown error at build time                                       |
| Missing template context or rendering failure  | You         | Thrown error from `run` / `runConversation` before any model call |

## `Result`

`Result<T, E>` has `isOk`, `value` and `error`. Reading `value` on an error result, or `error` on an ok result,
throws; always check `isOk` first.

```ts
const result = await agent.run("...");
if (result.isOk) {
    use(result.value);
} else {
    log(result.error);
}
```

## `AgentError`

Carries `message` and `transcript` (the conversation up to the failure). The transcript is valuable for
debugging and for logging exactly what the model did. It can also seed another run.

Messages you can expect:

- `Model hit the max token limit (N)`: raise `maxTokens` or ask for shorter answers.
- `Model did not submit a result`: the model kept answering in prose. Improve the prompt or output description.
- `Model submitted invalid results N times`: the model could not satisfy the output schema. Read the transcript
  to see which validation errors it received. Loosen the schema, add `describe` text, or raise `maxOutputRetries`.
- `No final answer after N turns`: the model kept calling tools. Raise `maxTurns`, or check whether a tool is
  returning something the model cannot use.

## Failure counting

Prose-instead-of-submit answers and invalid `submit_result` calls share one counter. The run fails when the
count exceeds `maxOutputRetries` (default 2, so the third failure ends the run). A valid submission always wins,
even if other calls in the same turn failed.

## Build-time errors

These throw immediately so mistakes surface at startup:

- `AgentFramework.create`: invalid config shape, an agent naming an undefined provider, tool discovery failure.
- `framework.agent(name)`: unknown agent name, unknown or lint-failing tool, invalid output schema, invalid limits.
- `framework.createAgent(config)`: invalid config, unknown provider, client creation failure, or the same build errors.
- `AgentBuilder.build()`: same checks for code-built agents.
- `ToolRegistry.registerToolClass` (via the decorator): duplicate tool name.
- `ToolCollector.collect`: missing path, import failure (with `cause`), duplicate names.

Liquid prompt syntax and filters are validated when an agent is built, including temporary runtime agents.
Missing context variables are checked at run time, so construction can accept prompts that need per-request
values. Rendering failures reject the run rather than becoming an `AgentError` result; use a conditional or
`default` filter for optional values. See [Prompt context](./agents.md#prompt-context).

Lint failures list every problem together, for example:

```
Invalid tools:
Tool "lookup": property "filters.status" has no description
Tool "lookup": description must not be empty
```

## Recommended structure for a request handler

```ts
try {
    const result = await (await framework.agent("support")).run(input);
    if (!result.isOk) {
        logger.warn({ transcript: result.error.transcript }, result.error.message);
        return fail(502, "The assistant could not complete the request");
    }
    return ok(result.value.output);
} catch (error) {
    if (error instanceof ModelClientError) {
        return fail(error.isRateLimited() ? 429 : 502, "Model provider unavailable");
    }
    throw error; // configuration or programming errors
}
```

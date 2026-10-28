# Runtime agent API

A complete, dependency-light Node HTTP server showing how to let authorized developers create agents at runtime
without redeploying. Agents may choose only the preinstalled `knowledge-search` tool and the configured OpenAI
provider. Runtime registrations are in memory; this project intentionally leaves persistence to the host app.

## Setup

Build and publish the framework from the repository root:

```bash
npm run build
yalc publish
```

Then in this directory:

```bash
yalc add @hiddendevs/agent-framework
npm install
export OPENAI_API_KEY="..."
export AGENT_API_TOKEN="a-long-random-secret"
npm start
```

The server binds to `127.0.0.1:3000` by default. `OPENAI_MODEL`, `HOST` and `PORT` are optional.

## Routes

Every route requires `Authorization: Bearer $AGENT_API_TOKEN`.

| Method   | Path                | Purpose                                      |
| -------- | ------------------- | -------------------------------------------- |
| `GET`    | `/agents`           | List in-memory agent names                   |
| `PUT`    | `/agents/:name`     | Validate and register an agent configuration |
| `POST`   | `/agents/:name/run` | Run an agent with `{ "input": "..." }`       |
| `DELETE` | `/agents/:name`     | Remove an agent                              |

Create an agent:

```bash
curl -X PUT http://127.0.0.1:3000/agents/support \
  -H "Authorization: Bearer $AGENT_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"provider":"openai","systemPrompt":"Answer support questions using tools: ${tools}","tools":["knowledge-search"],"maxTurns":5}'
```

Run it:

```bash
curl -X POST http://127.0.0.1:3000/agents/support/run \
  -H "Authorization: Bearer $AGENT_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"input":"When is support available?"}'
```

`registerAgent` validates the request and returns an error response without storing an invalid config. Provider keys
are server-side only; request data cannot supply a key or load code. The tool directory is fixed in source and
compiled before startup.

## Security and production notes

This is an instructional server, not a production-ready API gateway. Before exposing it beyond localhost, add
TLS, proper identity and authorization, request rate and concurrency limits, audit logging, persistence, and
per-user tool allowlists. The bearer token is a single shared secret; use a secret manager and rotate it. Agent
configs can invoke any tool in their allowlist, so do not register destructive or privileged tools for untrusted
users. Cap `maxTurns` and `maxTokens` in a production wrapper to manage cost.

Run `npm run typecheck` or `npm start` to compile the whole TypeScript project.

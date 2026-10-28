import { AgentFramework, ModelClientError } from "@hiddendevs/agent-framework";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { resolve } from "node:path";

const apiKey = process.env.OPENAI_API_KEY;
const accessToken = process.env.AGENT_API_TOKEN;
if (!apiKey) throw new Error("Set OPENAI_API_KEY before starting the API.");
if (!accessToken) throw new Error("Set AGENT_API_TOKEN to protect the example API.");

const framework = await AgentFramework.create({
    toolPaths: [resolve("dist/tools")],
    providers: {
        openai: {
            provider: "openai",
            model: process.env.OPENAI_MODEL ?? "gpt-4.1-mini",
            apiKey,
            maxRetries: 2,
            timeoutSeconds: 30,
        },
    },
    agents: {},
});

const send = (response: ServerResponse, status: number, body?: unknown): void => {
    response.statusCode = status;
    if (body === undefined) {
        response.end();
        return;
    }
    response.setHeader("content-type", "application/json; charset=utf-8");
    response.end(JSON.stringify(body));
};

const readJson = async (request: IncomingMessage): Promise<unknown> => {
    let body = "";
    for await (const chunk of request) {
        body += chunk instanceof Buffer ? chunk.toString("utf8") : String(chunk);
        if (body.length > 1_000_000) throw new Error("Request body exceeds 1 MB.");
    }
    return JSON.parse(body) as unknown;
};

const handle = async (request: IncomingMessage, response: ServerResponse): Promise<void> => {
    if (request.headers.authorization !== `Bearer ${accessToken}`) {
        send(response, 401, { error: "Unauthorized" });
        return;
    }

    const url = new URL(request.url ?? "/", "http://localhost");
    const segments = url.pathname.split("/").filter(Boolean).map(decodeURIComponent);

    if (request.method === "GET" && url.pathname === "/agents") {
        send(response, 200, { agents: framework.agentNames() });
        return;
    }

    if (segments.length === 2 && segments[0] === "agents") {
        const name = segments[1];
        if (name === undefined) {
            send(response, 400, { error: "Agent name is required." });
            return;
        }
        if (request.method === "PUT") {
            const registered = framework.registerAgent(name, await readJson(request));
            if (!registered.isOk) {
                send(response, 400, { error: registered.error.message });
                return;
            }
            send(response, 201, { name, config: registered.value });
            return;
        }
        if (request.method === "DELETE") {
            send(response, framework.unregisterAgent(name) ? 204 : 404);
            return;
        }
    }

    if (segments.length === 3 && segments[0] === "agents" && segments[2] === "run" && request.method === "POST") {
        const name = segments[1];
        const body = await readJson(request);
        if (name === undefined || typeof body !== "object" || body === null || !("input" in body)) {
            send(response, 400, { error: "Expected a JSON body with a string input." });
            return;
        }
        const input = (body as { readonly input?: unknown }).input;
        if (typeof input !== "string") {
            send(response, 400, { error: "The input property must be a string." });
            return;
        }
        try {
            const result = await (await framework.agent(name)).run(input);
            if (!result.isOk) {
                send(response, 502, { error: result.error.message, transcript: result.error.transcript });
                return;
            }
            send(response, 200, {
                output: result.value.output,
                finalText: result.value.finalText,
                turns: result.value.turns,
            });
        } catch (error) {
            const status = error instanceof ModelClientError && error.isRateLimited() ? 429 : 502;
            send(response, status, { error: error instanceof Error ? error.message : "Model request failed." });
        }
        return;
    }

    send(response, 404, { error: "Not found" });
};

const server = createServer((request, response) => {
    void handle(request, response).catch((error: unknown) => {
        send(response, 400, { error: error instanceof Error ? error.message : "Invalid request." });
    });
});

const host = process.env.HOST ?? "127.0.0.1";
const port = Number(process.env.PORT ?? "3000");
server.listen(port, host, () => console.log(`Agent API listening at http://${host}:${port}`));

import { AgentFramework, ModelClientError } from "@hiddendevs/agent-framework";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { resolve } from "node:path";
import z from "zod";

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

const runRequestSchema = z.object({
    config: z.unknown().refine((value) => value !== undefined, "Agent config is required."),
    input: z.string(),
    context: z.record(z.string(), z.unknown()).optional(),
});

const handle = async (request: IncomingMessage, response: ServerResponse): Promise<void> => {
    if (request.headers.authorization !== `Bearer ${accessToken}`) {
        send(response, 401, { error: "Unauthorized" });
        return;
    }

    const url = new URL(request.url ?? "/", "http://localhost");
    if (url.pathname === "/agents/run" && request.method === "POST") {
        const parsed = runRequestSchema.safeParse(await readJson(request));
        if (!parsed.success) {
            send(response, 400, { error: parsed.error.message });
            return;
        }
        const agent = await framework.createAgent(parsed.data.config);
        try {
            const result = await agent.run(parsed.data.input, parsed.data.context);
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

import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import z from "zod";

import {
    AgentFramework,
    AgentTool,
    Message,
    ModelResponse,
    StopReason,
    TextBlock,
    ToolBase,
    ToolCallBlock,
    ToolRegistry,
    type ModelClient,
    type ModelRequest,
} from "@hiddendevs/agent-framework";

const provider = { provider: "openai", model: "m", apiKey: "k" } as const;

describe("AgentFramework", () => {
    let dir: string;

    beforeEach(async () => {
        ToolRegistry.clearToolClasses();
        ToolRegistry.clearToolInstances();
        dir = await mkdtemp(join(tmpdir(), "af-"));
    });
    afterEach(() => rm(dir, { recursive: true, force: true }));

    it("discovers tools and builds a working agent from config alone", async () => {
        await writeFile(
            join(dir, "echo.mjs"),
            `import { AgentTool, ToolBase } from "@hiddendevs/agent-framework";
import z from "zod";
const schema = z.object({ msg: z.string().describe("message") });
export const Echo = AgentTool({ name: "echo", description: "Echo", inputValidationSchema: schema })(
    class extends ToolBase { execute(input) { return input.msg; } });
`,
        );

        const requests: ModelRequest[] = [];
        const script = [
            new ModelResponse(Message.assistant([new ToolCallBlock("1", "echo", { msg: "hi" })]), StopReason.TOOL_USE),
            new ModelResponse(
                Message.assistant([new ToolCallBlock("2", "submit_result", { reply: "hi" })]),
                StopReason.TOOL_USE,
            ),
        ];
        const client: ModelClient = {
            complete: async (request) => {
                requests.push(request);
                return script.shift() ?? new ModelResponse(Message.assistant([new TextBlock("end")]));
            },
        };

        const framework = await AgentFramework.create(
            {
                toolPaths: [dir],
                providers: { main: provider },
                agents: {
                    echoer: {
                        provider: "main",
                        tools: ["echo"],
                        outputSchema: {
                            type: "object",
                            required: ["reply"],
                            properties: { reply: { type: "string", description: "the reply" } },
                        },
                    },
                },
            },
            { clientFactory: async () => client },
        );

        const result = await (await framework.agent("echoer")).run("say hi");
        expect(result.value.output).toEqual({ reply: "hi" });
        expect(requests[0]?.tools.map((t) => t.name)).toEqual(["echo", "submit_result"]);
    });

    it("rejects bad config", async () => {
        await expect(
            AgentFramework.create({ providers: { main: provider }, agents: { a: { provider: "other" } } }),
        ).rejects.toThrow(/unknown provider "other"/);
        await expect(AgentFramework.create({ providers: {}, agents: { a: {} } } as never)).rejects.toThrow();

        const framework = await AgentFramework.create({
            providers: { main: provider },
            agents: { a: { provider: "main", tools: ["missing"] } },
        });
        await expect(framework.agent("nope")).rejects.toThrow(/Unknown agent/);
        await expect(framework.agent("a")).rejects.toThrow();
    });

    describe("runtime registration", () => {
        const make = async () => {
            const echo = z.object({ msg: z.string().describe("message") });
            @AgentTool({ name: "echo", description: "Echo", inputValidationSchema: echo })
            class Echo extends ToolBase<typeof echo> {
                public execute(input: z.infer<typeof echo>) {
                    return input.msg;
                }
            }
            void Echo;
            const client: ModelClient = {
                complete: async () => new ModelResponse(Message.assistant([new TextBlock("done")])),
            };
            return AgentFramework.create(
                { providers: { main: provider }, agents: {} },
                { clientFactory: async () => client },
            );
        };

        it("registers an agent after startup and runs it", async () => {
            const framework = await make();
            const registered = framework.registerAgent("late", { provider: "main", tools: ["echo"] });
            expect(registered.isOk).toBe(true);
            expect(framework.agentNames()).toEqual(["late"]);
            expect((await (await framework.agent("late")).run("hi")).value.output).toBe("done");
        });

        it("returns validation problems as data and registers nothing", async () => {
            const framework = await make();
            const cases: [unknown, RegExp][] = [
                [{ provider: "nope" }, /Unknown provider/],
                [{ provider: "main", tools: ["ghost"] }, /not registered/],
                [{ provider: "main", maxTurns: 0 }, /Invalid agent config/],
                [{ provider: "main", outputSchema: { type: "string", bogus: 1 } }, /unsupported keyword/],
            ];
            for (const [config, message] of cases) {
                const result = framework.registerAgent("bad", config);
                expect(result.isOk).toBe(false);
                expect(result.error.message).toMatch(message);
            }
            expect(framework.hasAgent("bad")).toBe(false);
        });

        it("rejects duplicates unless replacing, and supports unregistering", async () => {
            const framework = await make();
            framework.registerAgent("a", { provider: "main" });
            expect(framework.registerAgent("a", { provider: "main" }).isOk).toBe(false);
            expect(framework.registerAgent("a", { provider: "main", maxTurns: 3 }, { replace: true }).isOk).toBe(true);
            expect(framework.getAgentConfig("a")?.maxTurns).toBe(3);
            expect(framework.unregisterAgent("a")).toBe(true);
            expect(framework.unregisterAgent("a")).toBe(false);
        });

        it("registers providers at runtime", async () => {
            const framework = await make();
            expect(framework.registerAgent("a", { provider: "second" }).isOk).toBe(false);
            framework.registerProvider("second", provider);
            expect(framework.registerAgent("a", { provider: "second" }).isOk).toBe(true);
            expect(() => framework.registerProvider("x", { provider: "nope" } as never)).toThrow();
        });
    });
});

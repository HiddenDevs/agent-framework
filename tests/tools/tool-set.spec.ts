import z from "zod";

import { AgentTool, ToolBase, ToolRegistry, ToolSet } from "@hiddendevs/agent-framework";

const schema = z.object({ n: z.coerce.number().int().describe("a number") });

describe("ToolSet", () => {
    beforeEach(() => {
        ToolRegistry.clearToolClasses();
        ToolRegistry.clearToolInstances();
    });

    const register = (name = "double", execute: (n: number) => unknown = (n) => n * 2) => {
        @AgentTool({ name, description: "Doubles", inputValidationSchema: schema })
        class DoubleTool extends ToolBase<typeof schema> {
            public execute(input: z.infer<typeof schema>) {
                return execute(input.n) as number;
            }
        }
        return DoubleTool;
    };

    it("runs a valid call and coerces input", async () => {
        register();
        const result = await ToolSet.from(["double"]).call("double", { n: "4" });
        expect(result).toMatchObject({ content: 8, isError: false });
    });

    it("returns every validation issue as an error result", async () => {
        register();
        const result = await ToolSet.from(["double"]).call("double", {});
        expect(result.isError).toBe(true);
        expect(result.content).toMatch(/^Invalid arguments: n:/);
    });

    it("turns thrown and rejected errors into error results", async () => {
        register("boom", () => {
            throw new Error("kaput");
        });
        const result = await ToolSet.from(["boom"]).call("boom", { n: 1 });
        expect(result).toMatchObject({ content: "Tool boom failed: kaput", isError: true });
    });

    it("lists available tools for unknown names", async () => {
        register();
        const result = await ToolSet.from(["double"]).call("nope", {});
        expect(result).toMatchObject({ content: "Unknown tool: nope. Available tools: double", isError: true });
    });

    it("throws for unregistered names and supports plus()", () => {
        register("a");
        register("b");
        expect(() => ToolSet.from(["missing"])).toThrow(/not registered/);
        expect(
            ToolSet.from(["a"])
                .plus(ToolSet.from(["b"]))
                .names(),
        ).toEqual(["a", "b"]);
    });

    it("creates tools lazily through the factory and caches them", () => {
        const Tool = register();
        const factory = vi.fn((toolClass: new () => ToolBase<typeof schema>) => new toolClass());
        ToolSet.from(["double"], { factory: factory as never });
        ToolSet.from(["double"], { factory: factory as never });
        expect(factory).toHaveBeenCalledTimes(1);
        expect(factory).toHaveBeenCalledWith(Tool);
    });

    describe("lint", () => {
        it("rejects bad names, the reserved name and empty descriptions", () => {
            @AgentTool({ name: "bad name", description: "x", inputValidationSchema: schema })
            class A extends ToolBase<typeof schema> {
                public execute() {
                    return null;
                }
            }
            @AgentTool({ name: "submit_result", description: "x", inputValidationSchema: schema })
            class B extends ToolBase<typeof schema> {
                public execute() {
                    return null;
                }
            }
            @AgentTool({ name: "empty", description: " ", inputValidationSchema: schema })
            class C extends ToolBase<typeof schema> {
                public execute() {
                    return null;
                }
            }
            void [A, B, C];
            expect(() => ToolSet.from(["bad name"])).toThrow(/must match/);
            expect(() => ToolSet.from(["submit_result"])).toThrow(/reserved/);
            expect(() => ToolSet.from(["empty"])).toThrow(/description must not be empty/);
        });

        it("rejects undescribed properties, including nested array items", () => {
            const nested = z.object({ list: z.array(z.object({ inner: z.string() })).describe("items") });
            @AgentTool({ name: "nested", description: "x", inputValidationSchema: nested })
            class N extends ToolBase<typeof nested> {
                public execute() {
                    return null;
                }
            }
            void N;
            expect(() => ToolSet.from(["nested"])).toThrow(/property "list\[\]\.inner" has no description/);
        });
    });
});

import z from "zod";

import { AgentTool, ToolBase, ToolRegistry, type ToolClass, type ToolConfiguration } from "@hiddendevs/agent-framework";

describe("tool()", () => {
    beforeEach(() => {
        ToolRegistry.clearToolClasses();
        ToolRegistry.clearToolInstances();
    });

    it("should register the decorated concrete class by name", () => {
        const inputValidationSchema = z.object({ query: z.string() });
        const toolConfiguration: ToolConfiguration<typeof inputValidationSchema> = {
            name: "my-tool",
            description: "A tool for testing",
            inputValidationSchema,
        };

        @AgentTool(toolConfiguration)
        class MyTool extends ToolBase<typeof inputValidationSchema> {
            public execute(input: z.infer<typeof inputValidationSchema>) {
                return input;
            }
        }

        expect(ToolRegistry.getToolClass("my-tool")).toBe(MyTool);
        expect(new MyTool().execute({ query: "hello" })).toEqual({ query: "hello" });
    });

    it("should expose the configured metadata on the created class", () => {
        const inputValidationSchema = z.object({ query: z.string() });
        const toolConfiguration: ToolConfiguration<typeof inputValidationSchema> = {
            name: "metadata-tool",
            description: "A tool with metadata",
            inputValidationSchema,
        };

        @AgentTool(toolConfiguration)
        class MetadataTool extends ToolBase<typeof inputValidationSchema> {
            public execute(input: z.infer<typeof inputValidationSchema>) {
                return input;
            }
        }

        const registeredToolClass = ToolRegistry.getToolClass("metadata-tool") as ToolClass<
            typeof inputValidationSchema
        >;

        expect(registeredToolClass).toBe(MetadataTool);
        expect(registeredToolClass.name).toBe(toolConfiguration.name);
        expect(registeredToolClass.description).toBe(toolConfiguration.description);
        expect(registeredToolClass.inputValidationSchema).toBe(toolConfiguration.inputValidationSchema);
        expect(registeredToolClass.inputValidationSchema.parse({ query: "hello" })).toEqual({ query: "hello" });
    });

    it("should reject a tool name that is already registered", () => {
        const toolConfiguration: ToolConfiguration = {
            name: "duplicate-tool",
            description: "A tool for testing duplicates",
            inputValidationSchema: z.object(),
        };

        @AgentTool(toolConfiguration)
        class FirstTool extends ToolBase {
            public execute() {
                return {};
            }
        }

        expect(() => {
            @AgentTool(toolConfiguration)
            class DuplicateTool extends ToolBase {
                public execute() {
                    return {};
                }
            }

            void DuplicateTool;
        }).toThrow('Tool class with name "duplicate-tool" is already registered.');

        expect(ToolRegistry.getToolClass("duplicate-tool")).toBe(FirstTool);
    });
});

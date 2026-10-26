import type z from "zod";
import type { JSONValue, MaybeAsync } from "../global.js";
import { ToolRegistry } from "./tool-registry.js";

export type ToolConfiguration<InputSchema extends z.ZodObject = z.ZodObject> = {
    /** The unique name of the tool. */
    readonly name: string;
    /** A brief description of the tool's functionality. */
    readonly description: string;
    /** The schema used to validate the tool's input. */
    readonly inputValidationSchema: InputSchema;
};

export abstract class ToolBase<InputSchema extends z.ZodObject = z.ZodObject> {
    /** Executes the tool's functionality with the validated input. */
    public abstract execute(input: z.infer<InputSchema>): MaybeAsync<JSONValue>;
}

export type Tool<InputSchema extends z.ZodObject = z.ZodObject> = ToolBase<InputSchema>;
export type ToolClass<InputSchema extends z.ZodObject = z.ZodObject> = (abstract new (
    ...args: never[]
) => Tool<InputSchema>) & {
    readonly name: string;
    readonly description: string;
    readonly inputValidationSchema: InputSchema;
};

export const AgentTool =
    <InputSchema extends z.ZodObject>(configuration: ToolConfiguration<InputSchema>) =>
    <ToolConstructor extends abstract new (...args: never[]) => ToolBase<InputSchema>>(
        toolClass: ToolConstructor,
    ): ToolConstructor => {
        Object.defineProperties(toolClass, {
            name: { value: configuration.name },
            description: { value: configuration.description },
            inputValidationSchema: { value: configuration.inputValidationSchema },
        });

        ToolRegistry.registerToolClass(configuration.name, toolClass as unknown as ToolClass<InputSchema>);

        return toolClass;
    };

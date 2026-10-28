import z from "zod";
import type { ToolClass } from "./tool-decorator.js";

export const SUBMIT_TOOL_NAME = "submit_result";
const NAME_PATTERN = /^[a-zA-Z0-9_-]{1,64}$/;

type JsonNode = Record<string, unknown>;

const isNode = (value: unknown): value is JsonNode => typeof value === "object" && value !== null;

const hasDescription = (node: JsonNode): boolean =>
    typeof node["description"] === "string" ||
    ["anyOf", "oneOf", "allOf"].some(
        (key) => Array.isArray(node[key]) && (node[key] as unknown[]).some((n) => isNode(n) && hasDescription(n)),
    );

const collectUndescribed = (node: JsonNode, path: string, problems: string[]): void => {
    if (isNode(node["properties"])) {
        for (const [key, child] of Object.entries(node["properties"])) {
            if (!isNode(child)) continue;
            if (!hasDescription(child)) problems.push(`property "${path}${key}" has no description`);
            collectUndescribed(child, `${path}${key}.`, problems);
        }
    }
    if (isNode(node["items"])) collectUndescribed(node["items"], `${path.replace(/\.$/, "")}[].`, problems);
    for (const key of ["anyOf", "oneOf", "allOf"]) {
        const members = node[key];
        if (Array.isArray(members)) {
            for (const member of members) if (isNode(member)) collectUndescribed(member, path, problems);
        }
    }
};

/** Returns every problem found with a tool class; empty means valid. */
export const lintToolClass = (toolClass: ToolClass): string[] => {
    const problems: string[] = [];
    const name = toolClass.name;

    if (!NAME_PATTERN.test(name)) problems.push(`name "${name}" must match ${NAME_PATTERN.source}`);
    if (name === SUBMIT_TOOL_NAME) problems.push(`name "${SUBMIT_TOOL_NAME}" is reserved`);
    if (toolClass.description.trim().length === 0) problems.push("description must not be empty");

    const json = z.toJSONSchema(toolClass.inputValidationSchema, { io: "input" }) as JsonNode;
    if (json["type"] !== "object") problems.push("input schema must be an object");
    collectUndescribed(json, "", problems);

    return problems.map((problem) => `Tool "${name}": ${problem}`);
};

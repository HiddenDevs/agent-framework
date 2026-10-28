import z from "zod";

type Json = Record<string, unknown>;

const COMMON = ["type", "description", "default"];
const KEYWORDS: Record<string, readonly string[]> = {
    string: ["minLength", "maxLength", "pattern", "format", "enum"],
    number: ["minimum", "maximum", "x-coerceStrings"],
    integer: ["minimum", "maximum", "x-coerceStrings"],
    boolean: [],
    array: ["items", "minItems", "maxItems"],
    object: ["properties", "required", "additionalProperties"],
};
// Loose on purpose: matches the framework's historical email rule.
const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?)?$/;

const isRecord = (value: unknown): value is Json =>
    typeof value === "object" && value !== null && !Array.isArray(value);

/** Compiles the limited persisted JSON Schema dialect into Zod. */
export class JsonSchemaLoader {
    private constructor() {}

    /** Throws an Error naming the offending JSON path when the schema is unsupported or invalid. */
    public static fromJson(json: unknown): z.ZodType {
        return JsonSchemaLoader.compile(json, "#");
    }

    private static fail(path: string, message: string): never {
        throw new Error(`Invalid schema at ${path}: ${message}`);
    }

    private static number(node: Json, key: string, path: string): number {
        const value = node[key];
        if (typeof value !== "number") JsonSchemaLoader.fail(`${path}/${key}`, "must be a number");
        return value;
    }

    private static compile(json: unknown, path: string): z.ZodType {
        if (!isRecord(json)) return JsonSchemaLoader.fail(path, "must be an object");

        const declared = json["type"];
        const types = Array.isArray(declared) ? declared : [declared];
        const nullable = types.includes("null");
        const concrete = types.filter((t) => t !== "null");
        const type = concrete[0];
        if (concrete.length !== 1 || typeof type !== "string" || !(type in KEYWORDS)) {
            return JsonSchemaLoader.fail(`${path}/type`, 'must be one supported type, optionally with "null"');
        }

        const allowed = new Set([...COMMON, ...(KEYWORDS[type] ?? [])]);
        for (const key of Object.keys(json)) {
            if (!allowed.has(key)) JsonSchemaLoader.fail(`${path}/${key}`, `unsupported keyword "${key}"`);
        }

        let schema = JsonSchemaLoader.compileType(type, json, path);
        if (nullable) schema = schema.nullable();
        if ("default" in json) {
            const check = schema.safeParse(json["default"]);
            if (!check.success) JsonSchemaLoader.fail(`${path}/default`, "default does not satisfy its own schema");
            schema = schema.default(check.data as never);
        }
        return typeof json["description"] === "string" ? schema.describe(json["description"]) : schema;
    }

    private static compileType(type: string, node: Json, path: string): z.ZodType {
        switch (type) {
            case "string": {
                if (Array.isArray(node["enum"])) {
                    const values = node["enum"];
                    if (values.length === 0 || !values.every((v) => typeof v === "string")) {
                        JsonSchemaLoader.fail(`${path}/enum`, "must be a non-empty array of strings");
                    }
                    return z.enum(values as [string, ...string[]]);
                }
                let schema = z.string();
                if ("minLength" in node) schema = schema.min(JsonSchemaLoader.number(node, "minLength", path));
                if ("maxLength" in node) schema = schema.max(JsonSchemaLoader.number(node, "maxLength", path));
                if ("pattern" in node) {
                    if (typeof node["pattern"] !== "string")
                        JsonSchemaLoader.fail(`${path}/pattern`, "must be a string");
                    schema = schema.regex(new RegExp(node["pattern"]));
                }
                if ("format" in node) {
                    if (node["format"] === "email") schema = schema.regex(EMAIL, "Invalid email");
                    else if (node["format"] === "date") schema = schema.regex(ISO_DATE, "Invalid ISO-8601 date");
                    else JsonSchemaLoader.fail(`${path}/format`, 'must be "email" or "date"');
                }
                if (
                    typeof node["minLength"] === "number" &&
                    typeof node["maxLength"] === "number" &&
                    node["minLength"] > node["maxLength"]
                ) {
                    JsonSchemaLoader.fail(path, "minLength is greater than maxLength");
                }
                return schema;
            }
            case "number":
            case "integer": {
                const base = node["x-coerceStrings"] === true || type === "integer" ? z.coerce.number() : z.number();
                let schema = type === "integer" ? base.int() : base;
                if ("minimum" in node) schema = schema.min(JsonSchemaLoader.number(node, "minimum", path));
                if ("maximum" in node) schema = schema.max(JsonSchemaLoader.number(node, "maximum", path));
                return schema;
            }
            case "boolean":
                return z.boolean();
            case "array": {
                let schema = z.array(JsonSchemaLoader.compile(node["items"], `${path}/items`));
                if ("minItems" in node) schema = schema.min(JsonSchemaLoader.number(node, "minItems", path));
                if ("maxItems" in node) schema = schema.max(JsonSchemaLoader.number(node, "maxItems", path));
                return schema;
            }
            default:
                return JsonSchemaLoader.compileObject(node, path);
        }
    }

    private static compileObject(node: Json, path: string): z.ZodType {
        const properties = node["properties"] ?? {};
        if (!isRecord(properties)) return JsonSchemaLoader.fail(`${path}/properties`, "must be an object");
        const required = node["required"] ?? [];
        if (!Array.isArray(required) || !required.every((name) => typeof name === "string" && name in properties)) {
            return JsonSchemaLoader.fail(`${path}/required`, "must list names present in properties");
        }

        const shape: Record<string, z.ZodType> = {};
        for (const [name, child] of Object.entries(properties)) {
            const compiled = JsonSchemaLoader.compile(child, `${path}/properties/${name}`);
            const hasDefault = isRecord(child) && "default" in child;
            shape[name] = required.includes(name)
                ? compiled
                : hasDefault
                  ? compiled.optional()
                  : compiled.nullable().optional();
        }

        const extra = node["additionalProperties"];
        if (extra !== undefined && typeof extra !== "boolean") {
            return JsonSchemaLoader.fail(`${path}/additionalProperties`, "must be a boolean");
        }
        return extra === false ? z.strictObject(shape) : extra === true ? z.looseObject(shape) : z.object(shape);
    }
}

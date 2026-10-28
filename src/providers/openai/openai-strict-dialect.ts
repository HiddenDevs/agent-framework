import type z from "zod";
import { JsonSchemaUtil } from "../json-schema-util.js";
import type { ProviderDialect } from "../provider-dialect.js";

type Json = Record<string, unknown>;
type SchemaDef = {
    type: string;
    innerType?: z.ZodType;
    in?: z.ZodType;
    shape?: Record<string, z.ZodType>;
    element?: z.ZodType;
};

const defOf = (schema: z.ZodType): SchemaDef => (schema as unknown as { _zod: { def: SchemaDef } })._zod.def;

const unwrap = (schema: z.ZodType): z.ZodType => {
    const def = defOf(schema);
    if (["optional", "nullable", "default", "prefault", "readonly"].includes(def.type) && def.innerType) {
        return unwrap(def.innerType);
    }
    if (def.type === "pipe" && def.in) {
        return unwrap(def.in);
    }
    return schema;
};

const isRecord = (value: unknown): value is Json =>
    typeof value === "object" && value !== null && !Array.isArray(value);

/** OpenAI strict function calling: every property required, optionals nullable, no extra keys. */
export class OpenAiStrictDialect implements ProviderDialect {
    public constructor(private readonly unsupportedKeywords: ReadonlySet<string> = new Set(["$schema", "default"])) {}

    public adaptSchema(schemaJson: Json): Json {
        return this.rewrite(schemaJson);
    }

    /** Drops nulls for fields that may be absent, matching what the strict schema forced the model to send. */
    public normalizeArguments(args: Json, schema: z.ZodType): Json {
        const result = this.normalize(args, schema);
        return isRecord(result) ? result : args;
    }

    private rewrite(node: Json): Json {
        const out: Json = {};
        for (const [key, value] of Object.entries(node)) {
            if (this.unsupportedKeywords.has(key)) continue;
            if (key === "properties" && isRecord(value)) {
                out[key] = Object.fromEntries(
                    Object.entries(value).map(([name, child]) => [name, isRecord(child) ? this.rewrite(child) : child]),
                );
            } else if (key === "items" && isRecord(value)) {
                out[key] = this.rewrite(value);
            } else if ((key === "anyOf" || key === "oneOf" || key === "allOf") && Array.isArray(value)) {
                out[key] = value.map((member) => (isRecord(member) ? this.rewrite(member) : member));
            } else {
                out[key] = value;
            }
        }

        if (isRecord(out["properties"])) {
            const properties = out["properties"];
            const required = new Set(Array.isArray(node["required"]) ? (node["required"] as string[]) : []);
            for (const [name, child] of Object.entries(properties)) {
                if (!required.has(name) && isRecord(child)) properties[name] = JsonSchemaUtil.makeNullable(child);
            }
            out["required"] = Object.keys(properties);
            out["additionalProperties"] = false;
        }
        return out;
    }

    private normalize(value: unknown, schema: z.ZodType): unknown {
        const base = unwrap(schema);
        const def = defOf(base);

        if (def.type === "object" && def.shape && isRecord(value)) {
            const out: Json = {};
            for (const [key, child] of Object.entries(value)) {
                const fieldSchema = def.shape[key];
                if (!fieldSchema) {
                    out[key] = child;
                } else if (child === null && fieldSchema.safeParse(undefined).success) {
                    continue;
                } else {
                    out[key] = this.normalize(child, fieldSchema);
                }
            }
            return out;
        }
        if (def.type === "array" && def.element && Array.isArray(value)) {
            return value.map((item) => this.normalize(item, def.element as z.ZodType));
        }
        return value;
    }
}

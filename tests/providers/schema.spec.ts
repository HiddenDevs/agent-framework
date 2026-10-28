import z from "zod";

import { JsonSchemaUtil, OpenAiStrictDialect } from "@hiddendevs/agent-framework";

describe("OpenAiStrictDialect", () => {
    const schema = z.object({
        id: z.coerce.number().int().optional().describe("id"),
        name: z.string().describe("name"),
        tags: z
            .array(z.object({ label: z.string().nullable().optional().describe("l") }))
            .optional()
            .describe("tags"),
    });
    const dialect = new OpenAiStrictDialect();

    it("makes every property required, optionals nullable, and closes objects", () => {
        const emitted = z.toJSONSchema(schema, { io: "input" });
        const adapted = dialect.adaptSchema(emitted) as Record<string, any>;
        expect(adapted.$schema).toBeUndefined();
        expect(adapted.required).toEqual(["id", "name", "tags"]);
        expect(adapted.additionalProperties).toBe(false);
        expect(adapted.properties.id.type).toEqual(["integer", "null"]);
        expect(JSON.stringify(adapted.properties.name)).not.toContain("null");
        expect(adapted.properties.tags.type).toContain("null");
    });

    it("drops nulls for optional fields only and recurses into arrays", () => {
        const normalized = dialect.normalizeArguments({ id: null, name: "n", tags: [{ label: null }] }, schema);
        expect(normalized).toEqual({ name: "n", tags: [{}] });
        expect(schema.safeParse(normalized).success).toBe(true);

        const kept = dialect.normalizeArguments({ name: null }, schema);
        expect(kept).toEqual({ name: null });
    });
});

describe("JsonSchemaUtil.makeNullable", () => {
    it("handles type, enum and untyped nodes", () => {
        expect(JsonSchemaUtil.makeNullable({ type: "string" })).toEqual({ type: ["string", "null"] });
        expect(JsonSchemaUtil.makeNullable({ type: "string", enum: ["a"] })).toEqual({
            type: ["string", "null"],
            enum: ["a", null],
        });
        expect(JsonSchemaUtil.makeNullable({ anyOf: [] })).toEqual({ anyOf: [{ anyOf: [] }, { type: "null" }] });
    });
});

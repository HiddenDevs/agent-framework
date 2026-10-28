import z from "zod";

import { JsonSchemaLoader, JsonSchemaUtil, OpenAiStrictDialect } from "@hiddendevs/agent-framework";

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

describe("JsonSchemaLoader", () => {
    it("compiles supported keywords", () => {
        const schema = JsonSchemaLoader.fromJson({
            type: "object",
            required: ["name"],
            additionalProperties: false,
            properties: {
                name: { type: "string", minLength: 1, maxLength: 5, description: "n" },
                email: { type: "string", format: "email" },
                age: { type: "integer", minimum: 0 },
                kind: { type: "string", enum: ["a", "b"], default: "a" },
                tags: { type: "array", items: { type: "string" }, maxItems: 2 },
                note: { type: ["string", "null"] },
            },
        });
        expect(schema.safeParse({ name: "bob", age: "3", tags: ["x"], note: null }).data).toMatchObject({ age: 3 });
        expect(schema.safeParse({ name: "" }).success).toBe(false);
        expect(schema.safeParse({ name: "bob", email: "nope" }).success).toBe(false);
        expect(schema.safeParse({ name: "bob", extra: 1 }).success).toBe(false);
        expect(schema.safeParse({ name: "bob", tags: ["a", "b", "c"] }).success).toBe(false);
    });

    it.each([
        [{ type: "string", bogus: 1 }, /unsupported keyword "bogus"/],
        [{ type: "string", minLength: 5, maxLength: 1 }, /minLength is greater/],
        [{ type: "object", properties: {}, required: ["x"] }, /required/],
        [{ type: "string", enum: ["a"], default: "z" }, /default does not satisfy/],
        [{ type: "banana" }, /type/],
    ])("rejects %j", (json, message) => {
        expect(() => JsonSchemaLoader.fromJson(json)).toThrow(message);
    });

    it("reports a JSON-pointer-style path", () => {
        expect(() =>
            JsonSchemaLoader.fromJson({ type: "object", properties: { a: { type: "string", nope: true } } }),
        ).toThrow("#/properties/a/nope");
    });
});

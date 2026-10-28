type Json = Record<string, unknown>;

export class JsonSchemaUtil {
    private constructor() {}

    /** Makes a JSON Schema node accept null. */
    public static makeNullable(json: Json): Json {
        const type = json["type"];
        if (typeof type === "string") {
            const next: Json = { ...json, type: type === "null" ? type : [type, "null"] };
            if (Array.isArray(json["enum"]) && !json["enum"].includes(null)) {
                next["enum"] = [...json["enum"], null];
            }
            return next;
        }
        if (Array.isArray(type)) {
            return type.includes("null") ? json : { ...json, type: [...type, "null"] };
        }
        return { anyOf: [json, { type: "null" }] };
    }
}

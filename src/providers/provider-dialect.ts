import type z from "zod";

/** Adapts schemas and arguments to a provider's function-calling rules. */
export interface ProviderDialect {
    /** Rewrites an emitted JSON Schema into what the provider accepts. */
    adaptSchema(schemaJson: Record<string, unknown>): Record<string, unknown>;
    /** Reshapes model-supplied arguments so they validate against `schema`. */
    normalizeArguments(args: Record<string, unknown>, schema: z.ZodType): Record<string, unknown>;
}

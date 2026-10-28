import { AgentTool, ToolBase } from "@hiddendevs/agent-framework";
import z from "zod";

const inputSchema = z.object({
    query: z.string().min(1).describe("Search phrase"),
});

@AgentTool({
    name: "knowledge-search",
    description: "Search the sample knowledge base for a relevant answer",
    inputValidationSchema: inputSchema,
})
export class KnowledgeSearchTool extends ToolBase<typeof inputSchema> {
    public execute(input: z.infer<typeof inputSchema>): { readonly matches: string[] } {
        const normalized = input.query.toLowerCase();
        const matches = [
            "Support is available Monday through Friday, 09:00 to 17:00 UTC.",
            "A refund can be requested within 30 days of purchase.",
            "Account email addresses can be changed from profile settings.",
        ].filter((entry) => entry.toLowerCase().includes(normalized) || normalized.includes("support"));

        return { matches };
    }
}

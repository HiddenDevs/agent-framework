import { AgentTool, ToolBase } from "@hiddendevs/agent-framework";
import z from "zod";

const inputSchema = z.object({
    accountId: z.string().min(1).describe("Account identifier to look up"),
});

export type Account = {
    readonly id: string;
    readonly plan: "starter" | "team";
    readonly active: boolean;
};

export interface AccountService {
    findById(id: string): Account | null;
}

@AgentTool({
    name: "account-lookup",
    description: "Look up a customer's account plan and active status by account id",
    inputValidationSchema: inputSchema,
})
export class AccountLookupTool extends ToolBase<typeof inputSchema> {
    public constructor(private readonly accounts: AccountService) {
        super();
    }

    public execute(input: z.infer<typeof inputSchema>): Account | { readonly error: string } {
        const account = this.accounts.findById(input.accountId);
        return account ?? { error: `No account found for ${input.accountId}` };
    }
}

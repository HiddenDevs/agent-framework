import { AgentTool, ToolBase } from "@hiddendevs/agent-framework";
import z from "zod";

const inputSchema = z.object({
    city: z.string().min(1).describe("City to get current weather for"),
});

type Weather = {
    readonly city: string;
    readonly temperatureC: number;
    readonly condition: string;
};

@AgentTool({
    name: "current-weather",
    description: "Get a sample current-weather reading for a city",
    inputValidationSchema: inputSchema,
})
export class CurrentWeatherTool extends ToolBase<typeof inputSchema> {
    public execute(input: z.infer<typeof inputSchema>): Weather {
        return {
            city: input.city,
            temperatureC: 18,
            condition: "partly cloudy",
        };
    }
}

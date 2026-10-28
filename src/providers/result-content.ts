import type { JSONValue } from "../global.js";

/** Renders tool result content as the text providers expect. */
export const asText = (content: JSONValue | undefined): string =>
    content === null || content === undefined ? "" : typeof content === "string" ? content : JSON.stringify(content);

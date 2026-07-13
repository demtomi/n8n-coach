import type { UIMessage } from "ai";

// Hard caps on anything a stranger can put into a request. Every one of these bounds a
// real cost: the endpoint is public, unauthenticated, and each accepted request buys a
// Voyage embed, a 50-doc Voyage rerank, and a Sonnet 4.6 call.
//
// These are sized around the app's ACTUAL job. Debug mode exists to take a pasted n8n
// workflow, and a realistic 20-node export runs ~10k characters (a 30-node one ~15k).
// An 8k cap would reject the headline feature, so the character budget is generous and
// the real bound is the node count plus the global daily spend ceiling.
export const MAX_BODY_CHARS = 400_000; // JS string length, not bytes
export const MAX_MESSAGES = 6; // last N turns; the client may send more, we keep the tail
export const MAX_MESSAGE_CHARS = 60_000; // one message, comfortably fits a large workflow
export const MAX_TOTAL_CHARS = 90_000; // across the whole kept history
export const MAX_WORKFLOW_NODES = 150;
export const MAX_OUTPUT_TOKENS = 2_500; // a structured debug diagnosis needs room

export type ValidationError = { status: number; message: string };

export type CleanMessage = {
  id: string;
  role: "user" | "assistant";
  parts: Array<{ type: "text"; text: string }>;
};

function textOf(m: unknown): string {
  const parts = (m as { parts?: unknown }).parts;
  if (!Array.isArray(parts)) return "";
  return parts
    .filter(
      (p): p is { type: "text"; text: string } =>
        !!p &&
        typeof p === "object" &&
        (p as { type?: unknown }).type === "text" &&
        typeof (p as { text?: unknown }).text === "string"
    )
    .map((p) => p.text)
    .join("\n");
}

/**
 * Turn an untrusted request body into a bounded, known-shaped message list.
 *
 * Returns a ValidationError instead of throwing so the route can answer with a status
 * code rather than a 500. Anything not explicitly allowed is dropped: unknown roles
 * (system, tool), non-text parts, and every field we do not read.
 */
export function parseMessages(body: unknown): CleanMessage[] | ValidationError {
  if (!body || typeof body !== "object") {
    return { status: 400, message: "Malformed request." };
  }
  const raw = (body as { messages?: unknown }).messages;
  if (!Array.isArray(raw)) {
    return { status: 400, message: "Malformed request: messages must be a list." };
  }
  if (raw.length === 0) {
    return { status: 400, message: "Empty request." };
  }

  // Keep only the tail. A 200-turn history costs the same per token as a fresh one, so
  // an uncapped history is an uncapped bill.
  const tail = raw.slice(-MAX_MESSAGES);

  const clean: CleanMessage[] = [];
  for (const m of tail) {
    if (!m || typeof m !== "object") continue;
    const role = (m as { role?: unknown }).role;
    // Drop system and tool roles outright: the system prompt is server-side and is not
    // something a caller gets to contribute to.
    if (role !== "user" && role !== "assistant") continue;

    const text = textOf(m);
    if (!text) continue;
    if (text.length > MAX_MESSAGE_CHARS) {
      return {
        status: 413,
        message: `That message is too long. Keep it under ${MAX_MESSAGE_CHARS.toLocaleString()} characters, including any pasted workflow.`,
      };
    }

    const id = (m as { id?: unknown }).id;
    clean.push({
      id: typeof id === "string" ? id : `m${clean.length}`,
      role,
      parts: [{ type: "text", text }],
    });
  }

  if (clean.length === 0) {
    return { status: 400, message: "Empty request." };
  }
  if (clean.at(-1)?.role !== "user") {
    return { status: 400, message: "Malformed request: last message must be from the user." };
  }

  const total = clean.reduce((n, m) => n + m.parts[0].text.length, 0);
  if (total > MAX_TOTAL_CHARS) {
    return {
      status: 413,
      message: "This conversation is too long to continue. Start a new chat.",
    };
  }

  return clean;
}

/** Total characters we are about to send, used to size the spend reservation. */
export function totalChars(messages: CleanMessage[]): number {
  return messages.reduce((n, m) => n + m.parts[0].text.length, 0);
}

/** CleanMessage is a structural subset of UIMessage; the SDK only reads what we kept. */
export function toUIMessages(messages: CleanMessage[]): UIMessage[] {
  return messages as unknown as UIMessage[];
}

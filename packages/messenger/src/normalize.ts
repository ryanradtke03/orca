import type { MessengerEvent } from "./types.js";

// Loose shapes of what `claude -p --output-format stream-json` prints.
// Only the fields we read; everything else is ignored.
interface TextBlock {
  type: "text";
  text: string;
}
interface ToolUseBlock {
  type: "tool_use";
  id: string;
  name: string;
  input: unknown;
}
interface ToolResultBlock {
  type: "tool_result";
  tool_use_id: string;
  content?: unknown;
  is_error?: boolean;
}
type ContentBlock =
  | TextBlock
  | ToolUseBlock
  | ToolResultBlock
  | { type: string };

interface ClaudeLine {
  type?: string;
  subtype?: string;
  message?: { content?: ContentBlock[] | string };
  result?: string;
  is_error?: boolean;
  session_id?: string;
  total_cost_usd?: number;
  num_turns?: number;
  errors?: string[]; // e.g. ["Reached maximum number of turns (1)"]
  terminal_reason?: string; // e.g. "max_turns"
}

const isText = (b: ContentBlock): b is TextBlock =>
  b.type === "text" && "text" in b;
const isToolUse = (b: ContentBlock): b is ToolUseBlock =>
  b.type === "tool_use" && "id" in b;
const isToolResult = (b: ContentBlock): b is ToolResultBlock =>
  b.type === "tool_result" && "tool_use_id" in b;

/**
 * Tool results come back either as a plain string or as an array of blocks
 * (usually text, sometimes images). Flatten text to one string; keep anything else as-is.
 */
function toolOutput(content: unknown): unknown {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    const texts = content.filter(
      (c): c is TextBlock => c?.type === "text" && typeof c.text === "string",
    );
    if (texts.length === content.length)
      return texts.map((t) => t.text).join("\n");
  }
  return content;
}

/**
 * Returns a function that maps one Claude line → zero or more MessengerEvents.
 * It's a factory because it remembers tool_use id → tool name across lines:
 * the tool_result line only carries the id.
 */
export function createNormalizer() {
  const toolNames = new Map<string, string>();

  return function normalize(raw: unknown): MessengerEvent[] {
    const msg = raw as ClaudeLine;

    switch (msg?.type) {
      // Claude speaking: text and/or tool calls (possibly several in one message)
      case "assistant": {
        const content = Array.isArray(msg.message?.content)
          ? msg.message.content
          : [];
        const events: MessengerEvent[] = [];
        for (const block of content) {
          if (isText(block)) {
            events.push({ type: "message", text: block.text });
          } else if (isToolUse(block)) {
            toolNames.set(block.id, block.name);
            events.push({
              type: "tool_use",
              id: block.id,
              name: block.name,
              input: block.input,
            });
          }
          // other block types (e.g. thinking) are skipped for now
        }
        return events;
      }

      // The harness reporting tool results back to Claude (they arrive as "user" messages)
      case "user": {
        const content = Array.isArray(msg.message?.content)
          ? msg.message.content
          : [];
        const events: MessengerEvent[] = [];
        for (const block of content) {
          if (isToolResult(block)) {
            events.push({
              type: "tool_result",
              toolUseId: block.tool_use_id,
              name: toolNames.get(block.tool_use_id),
              output: toolOutput(block.content),
              isError: block.is_error === true,
            });
          }
        }
        return events;
      }

      case "result": {
        // Some errors (e.g. hitting max turns) come back as subtype "error_*"
        const isError =
          msg.is_error === true || (msg.subtype?.startsWith("error") ?? false);
        const hitMaxTurns =
          msg.subtype === "error_max_turns" ||
          msg.terminal_reason === "max_turns";
        return [
          {
            type: "done",
            ok: !isError,
            text: msg.result,
            sessionId: msg.session_id,
            costUsd: msg.total_cost_usd,
            turns: msg.num_turns,
            ...(isError && {
              error: {
                kind: hitMaxTurns
                  ? ("max_turns" as const)
                  : ("claude_error" as const),
                message:
                  msg.errors?.join("; ") ||
                  msg.subtype ||
                  "Claude reported an error",
              },
            }),
          },
        ];
      }

      default:
        // system (init, commands_changed), rate_limit_event, anything new: pass through untouched
        return [{ type: "raw", msg }];
    }
  };
}

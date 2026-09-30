import { fileURLToPath } from "node:url";

/** Absolute path to a file in fixtures/ */
export const fixture = (name: string) =>
  fileURLToPath(new URL(`../fixtures/${name}`, import.meta.url));
/** Absolute path to a fake claude script in test/ */
export const fakeBin = (name: string) =>
  fileURLToPath(new URL(`./${name}`, import.meta.url));

/** Inline fixture: a talk-only reply with a given text and session id. */
export const reply = (text: string, sessionId = "s-1") => [
  { type: "system", subtype: "init", session_id: sessionId },
  { type: "assistant", message: { content: [{ type: "text", text }] } },
  {
    type: "result",
    subtype: "success",
    is_error: false,
    result: text,
    session_id: sessionId,
    total_cost_usd: 0.01,
    num_turns: 1,
  },
];

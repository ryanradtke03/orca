#!/usr/bin/env node
// Stand-in for a tool-using run: reads a file, a grep fails, then answers.
const out = (o) => console.log(JSON.stringify(o));
const say = (content) => out({ type: "assistant", message: { role: "assistant", content } });
const results = (content) => out({ type: "user", message: { role: "user", content } });

out({ type: "system", subtype: "init", session_id: "tools-1", tools: ["Read", "Grep"] });
say([
  { type: "text", text: "I'll read the notes file." },
  { type: "tool_use", id: "toolu_01", name: "Read", input: { file_path: "notes.txt" } },
]);
results([{ type: "tool_result", tool_use_id: "toolu_01", content: "the secret word is teal" }]);
say([{ type: "tool_use", id: "toolu_02", name: "Grep", input: { pattern: "password" } }]);
results([{ type: "tool_result", tool_use_id: "toolu_02", content: [{ type: "text", text: "No matches found" }], is_error: true }]);
say([{ type: "text", text: "The secret word is teal." }]);
out({ type: "result", subtype: "success", is_error: false, result: "The secret word is teal.", session_id: "tools-1", total_cost_usd: 0.03, num_turns: 3 });

#!/usr/bin/env node
// A minimal stand-in for a talk-only Claude run: init, one assistant message, a result.
const out = (o) => console.log(JSON.stringify(o));

out({ type: "system", subtype: "init", cwd: process.cwd(), session_id: "fake-1", tools: [] });
out({
  type: "assistant",
  message: { role: "assistant", content: [{ type: "text", text: "Hi there, friend!" }] },
  session_id: "fake-1",
});
out({
  type: "result",
  subtype: "success",
  is_error: false,
  result: "Hi there, friend!",
  session_id: "fake-1",
  total_cost_usd: 0.0055,
  num_turns: 1,
});

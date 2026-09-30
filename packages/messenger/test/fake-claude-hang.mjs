#!/usr/bin/env node
console.log(JSON.stringify({ type: "system", subtype: "init", session_id: "hang-1" }));
if (process.argv.includes("--stubborn")) process.on("SIGTERM", () => console.error("ignoring SIGTERM"));
setInterval(() => {}, 1000); // keep running forever

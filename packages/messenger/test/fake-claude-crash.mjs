#!/usr/bin/env node
// writeSync so nothing is lost when we exit right after (pipes are async in Node).
import { writeSync } from "node:fs";
for (let i = 0; i < 5000; i++) writeSync(2, `noise line ${i}\n`);
writeSync(2, "Error: something broke at the end\n");
process.exit(2);

// Runs evidence extraction against the saved real-call fixture.
import "dotenv/config";
import { readFileSync } from "node:fs";
import { extractEvidence } from "../src/evidence/extract.js";

const task = JSON.parse(readFileSync("fixtures/first-real-call.json", "utf8"));
const ev = await extractEvidence(task.brief, task.calls[0].transcript);
console.log(JSON.stringify(ev, null, 2));

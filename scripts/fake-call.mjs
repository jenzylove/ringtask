// End-to-end voice-loop test without a phone: creates a task, then
// connects to /media pretending to be Twilio. Streams mulaw silence
// like a quiet phone line and reports every frame the agent sends
// back (greeting audio = the full Deepgram->LLM->TTS loop works).
import WebSocket from "ws";

const host = process.argv[2] ?? "localhost:3001";
const httpScheme = host.startsWith("localhost") ? "http" : "https";
const wsScheme = host.startsWith("localhost") ? "ws" : "wss";

const brief = {
  goal: "Find same-day iPhone 15 screen repair",
  location: "Lekki, Lagos",
  maxPrice: 130000,
  requiredAnswers: ["screen availability", "total price", "completion time", "warranty"],
  allowedActions: ["hold appointment"],
  userDisplayName: "a RingTask test customer"
};

const res = await fetch(`${httpScheme}://${host}/v1/tasks`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(brief)
});
const { taskId } = await res.json();
console.log("task:", taskId);

const ws = new WebSocket(`${wsScheme}://${host}/media`);
const t0 = Date.now();
const stamp = () => `+${Date.now() - t0}ms`;
let audioFrames = 0;
let audioBytes = 0;

ws.on("open", () => {
  console.log(stamp(), "WS open, sending start");
  ws.send(JSON.stringify({ event: "connected", protocol: "Call", version: "1.0.0" }));
  ws.send(JSON.stringify({
    event: "start",
    sequenceNumber: "1",
    streamSid: "MZfake",
    start: {
      streamSid: "MZfake", callSid: "CAfake", accountSid: "ACfake",
      tracks: ["inbound"], customParameters: { taskId },
      mediaFormat: { encoding: "audio/x-mulaw", sampleRate: 8000, channels: 1 }
    }
  }));
  // stream mulaw silence (0xFF) at 20ms cadence like a real call
  const silence = Buffer.alloc(160, 0xff).toString("base64");
  const feed = setInterval(() => {
    if (ws.readyState !== WebSocket.OPEN) return clearInterval(feed);
    ws.send(JSON.stringify({ event: "media", streamSid: "MZfake", media: { payload: silence } }));
  }, 20);
});

ws.on("message", (m) => {
  const msg = JSON.parse(m.toString());
  if (msg.event === "media") {
    audioFrames++;
    audioBytes += Buffer.from(msg.media.payload, "base64").length;
    if (audioFrames === 1) console.log(stamp(), "FIRST AGENT AUDIO FRAME 🎉");
  } else {
    console.log(stamp(), "event:", msg.event, JSON.stringify(msg).slice(0, 120));
  }
});
ws.on("close", (c) => { report("close " + c); });
ws.on("error", (e) => { console.log(stamp(), "ERROR:", e.message); process.exit(1); });
setTimeout(() => { report("timeout"); }, 25000);

function report(why) {
  const secs = audioBytes / 8000; // mulaw 8k = 8000 bytes/sec
  console.log(stamp(), `RESULT (${why}): ${audioFrames} agent audio frames = ${secs.toFixed(1)}s of speech`);
  process.exit(0);
}

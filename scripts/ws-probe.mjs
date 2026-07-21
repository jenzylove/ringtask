// Probes the deployed /media websocket like Twilio would:
// connect, send connected + start frames, report what happens.
import WebSocket from "ws";

const host = process.argv[2] ?? "ringtask.onrender.com";
const scheme = host.startsWith("localhost") ? "ws" : "wss";
const ws = new WebSocket(`${scheme}://${host}/media`);
const t0 = Date.now();
const stamp = () => `+${Date.now() - t0}ms`;

ws.on("open", () => {
  console.log(stamp(), "WS OPEN — upgrade succeeded");
  ws.send(JSON.stringify({ event: "connected", protocol: "Call", version: "1.0.0" }));
  ws.send(JSON.stringify({
    event: "start",
    sequenceNumber: "1",
    start: {
      streamSid: "MZprobe", callSid: "CAprobe", accountSid: "ACprobe",
      tracks: ["inbound"], customParameters: { taskId: "task_probe_nonexistent" },
      mediaFormat: { encoding: "audio/x-mulaw", sampleRate: 8000, channels: 1 }
    },
    streamSid: "MZprobe"
  }));
});
ws.on("message", (m) => console.log(stamp(), "MSG:", m.toString().slice(0, 200)));
ws.on("close", (code, reason) => { console.log(stamp(), `CLOSE code=${code} reason=${reason}`); process.exit(0); });
ws.on("error", (e) => { console.log(stamp(), "ERROR:", e.message); process.exit(1); });
setTimeout(() => { console.log(stamp(), "TIMEOUT (no close after 15s — server kept socket open)"); process.exit(0); }, 15000);

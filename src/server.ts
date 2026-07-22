import "dotenv/config";
import Fastify from "fastify";
import twilio from "twilio";
import websocket from "@fastify/websocket";
import formbody from "@fastify/formbody";
import { randomUUID } from "node:crypto";
import { BriefSchema, type Brief } from "./brief.js";
import { paymentChallenge, verifyPaymentHeader, paymentReceipt, type VerifiedPayment } from "./x402.js";
import { placeCall, twimlForStream } from "./telephony/twilio.js";
import { CallSession, type TranscriptEntry } from "./call/session.js";
import { extractEvidence, type CallEvidence } from "./evidence/extract.js";
import { renderResultPage } from "./resultPage.js";
import { renderLandingPage } from "./landingPage.js";

interface CallRecord {
  callSid?: string;
  to: string;
  status: string;
  transcript: TranscriptEntry[];
  startedAt: string;
  evidence?: CallEvidence;
  retried?: boolean;
}

interface Task {
  taskId: string;
  brief: Brief;
  status: "created" | "calling" | "completed";
  calls: CallRecord[];
}

const tasks = new Map<string, Task>();

const app = Fastify({ logger: true });
await app.register(websocket);
await app.register(formbody);

const debugRing: string[] = [];
export function dbg(msg: string): void {
  debugRing.push(`${new Date().toISOString()} ${msg}`);
  if (debugRing.length > 200) debugRing.shift();
  app.log.info(msg);
}

process.on("uncaughtException", (e) => { dbg(`uncaughtException: ${e.message}`); process.exit(1); });
process.on("unhandledRejection", (e) => { dbg(`unhandledRejection: ${(e as Error)?.message ?? e}`); process.exit(1); });

app.get("/health", async () => ({ ok: true, tasks: tasks.size, uptime: process.uptime() }));

// API-key gate: the whole /v1 API (reads included — transcripts are private)
// plus /debug. Twilio webhooks are signature-validated instead; the /t page
// is shareable but redacted.
app.addHook("onRequest", async (req, reply) => {
  const path = req.url.split("?")[0];
  const key = process.env.RINGTASK_API_KEY;
  // A2MCP entry: /v1/tasks is x402-gated — api key OR payment header unlocks;
  // anything else gets the 402 challenge (both v2 header and v1 body forms).
  if (path === "/v1/tasks") {
    if (key && req.headers["x-api-key"] === key) return;
    if (req.method === "POST" && (req.headers["payment-signature"] || req.headers["x-payment"])) return;
    const challenge = paymentChallenge(`https://${process.env.PUBLIC_HOST}/v1/tasks`);
    return reply.code(402).header("PAYMENT-REQUIRED", challenge.header).send(challenge.body);
  }
  const gated = req.url.startsWith("/v1/") || req.url.startsWith("/debug");
  if (!gated) return;
  if (!key) return; // no key configured (local dev) — open
  if (req.headers["x-api-key"] !== key) {
    return reply.code(401).send({ error: "invalid or missing x-api-key" });
  }
});

// Explicit GET so unauthenticated probes reach the 402 hook, not a 404.
app.get("/v1/tasks", async () => ({ ok: true }));

app.get("/debug", async () => ({ uptime: process.uptime(), events: debugRing }));

/** Validate X-Twilio-Signature on webhook callbacks (skipped in local dev without a token). */
function isFromTwilio(req: { headers: Record<string, unknown>; body?: unknown; url: string }): boolean {
  const token = process.env.TWILIO_AUTH_TOKEN;
  if (!token || !process.env.PUBLIC_HOST) return true;
  const sig = req.headers["x-twilio-signature"];
  if (typeof sig !== "string") return false;
  const url = `https://${process.env.PUBLIC_HOST}${req.url}`;
  return twilio.validateRequest(token, sig, url, (req.body as Record<string, string>) ?? {});
}

// ---- Task API -------------------------------------------------------------

const DEMO_BRIEF = {
  goal: "Find same-day iPhone 15 screen repair (demo task)",
  location: "Lekki, Lagos",
  maxPrice: 130000,
  requiredAnswers: ["availability", "total price", "completion time", "warranty"]
};

function makeTask(brief: Brief): Task {
  const task: Task = { taskId: `task_${randomUUID()}`, brief, status: "created", calls: [] };
  tasks.set(task.taskId, task);
  return task;
}

app.post("/v1/tasks", async (req, reply) => {
  // Paid x402 request or x-api-key both unlock task creation.
  const payHeader = (req.headers["payment-signature"] ?? req.headers["x-payment"]) as string | undefined;
  let payment: VerifiedPayment | null = null;
  if (payHeader) {
    const v = verifyPaymentHeader(payHeader);
    if (typeof v === "string") {
      dbg(`x402 payment rejected: ${v}`);
      return reply.code(402).send({ error: `payment invalid: ${v}` });
    }
    payment = v;
    dbg(`x402 payment accepted from ${payment.payer} (${payment.scheme})`);
  }
  const parsed = BriefSchema.safeParse(req.body);
  if (!parsed.success) {
    // Paid request with an empty/invalid brief still gets a deliverable: a
    // demo task (task creation alone never places calls).
    if (payment) {
      const task = makeTask(BriefSchema.parse(DEMO_BRIEF));
      reply.header("PAYMENT-RESPONSE", paymentReceipt(payment));
      return {
        taskId: task.taskId, status: task.status,
        note: "brief missing/invalid — demo task created; normalizedBrief shows the expected shape",
        normalizedBrief: task.brief,
        resultUrl: `https://${process.env.PUBLIC_HOST}/t/${task.taskId}`
      };
    }
    return reply.code(400).send({ error: parsed.error.flatten() });
  }
  const task = makeTask(parsed.data);
  if (payment) reply.header("PAYMENT-RESPONSE", paymentReceipt(payment));
  return { taskId: task.taskId, status: task.status, normalizedBrief: task.brief, resultUrl: `https://${process.env.PUBLIC_HOST}/t/${task.taskId}` };
});

app.post<{ Params: { id: string }; Body: { to: string } }>("/v1/tasks/:id/call", async (req, reply) => {
  const task = tasks.get(req.params.id);
  if (!task) return reply.code(404).send({ error: "task not found" });
  const to = (req.body as any)?.to;
  if (!/^\+\d{7,15}$/.test(to ?? "")) return reply.code(400).send({ error: "to must be E.164, e.g. +2348012345678" });
  const uniqueNumbers = new Set(task.calls.map((c) => c.to));
  if (!uniqueNumbers.has(to) && uniqueNumbers.size >= task.brief.maxBusinesses) {
    return reply.code(400).send({ error: `task limited to ${task.brief.maxBusinesses} businesses` });
  }
  const record: CallRecord = { to, status: "initiated", transcript: [], startedAt: new Date().toISOString() };
  task.calls.push(record);
  task.status = "calling";
  const { callSid } = await placeCall(to, task.taskId);
  record.callSid = callSid;
  return { taskId: task.taskId, callSid, status: "initiated" };
});

app.get<{ Params: { id: string } }>("/v1/tasks/:id", async (req, reply) => {
  const task = tasks.get(req.params.id);
  if (!task) return reply.code(404).send({ error: "task not found" });
  return task;
});

app.get("/", async (_req, reply) => {
  reply.type("text/html").send(renderLandingPage());
});

app.get<{ Params: { id: string } }>("/t/:id", async (req, reply) => {
  const task = tasks.get(req.params.id);
  if (!task) return reply.code(404).type("text/html").send("<h1>Task not found</h1>");
  // Shareable page: redact destination numbers to last 4 digits.
  const redacted = task.calls.map((c) => ({ ...c, to: `•••${c.to.slice(-4)}` }));
  reply.type("text/html").send(renderResultPage(task.taskId, task.brief, task.status, redacted));
});

// ---- Twilio webhooks ------------------------------------------------------

app.all("/twiml", async (req, reply) => {
  if (!isFromTwilio(req as any)) return reply.code(403).send("forbidden");
  const taskId = (req.query as any).taskId ?? "";
  dbg(`twiml served for ${taskId}`);
  reply.type("text/xml").send(twimlForStream(taskId));
});

const RETRY_DELAY_MS = Number(process.env.RETRY_DELAY_MS ?? 120_000);

app.post("/call-status", async (req, reply) => {
  if (!isFromTwilio(req as any)) return reply.code(403).send("forbidden");
  const body = req.body as any;
  const task = tasks.get((req.query as any).taskId ?? "");
  const rec = task?.calls.find((c) => c.callSid === body.CallSid);
  if (rec) rec.status = body.CallStatus;
  dbg(`call status ${body.CallSid} -> ${body.CallStatus}`);

  // Retry policy: one automatic redial per number on no-answer/busy.
  if (task && rec && ["no-answer", "busy"].includes(body.CallStatus) && !rec.retried) {
    rec.retried = true;
    dbg(`[${task.taskId}] scheduling retry of ${rec.to} in ${RETRY_DELAY_MS / 1000}s`);
    setTimeout(async () => {
      try {
        const retry: CallRecord = { to: rec.to, status: "initiated", transcript: [], startedAt: new Date().toISOString(), retried: true };
        task.calls.push(retry);
        const { callSid } = await placeCall(rec.to, task.taskId);
        retry.callSid = callSid;
        dbg(`[${task.taskId}] retry placed ${callSid}`);
      } catch (e: any) {
        dbg(`[${task.taskId}] retry failed: ${e.message}`);
      }
    }, RETRY_DELAY_MS);
  }
  return "ok";
});

// ---- Media stream ---------------------------------------------------------

app.get("/media", { websocket: true }, (ws, req) => {
  dbg(`media WS connected from ${req.headers["x-forwarded-for"] ?? req.ip} ua=${req.headers["user-agent"] ?? "?"}`);
  let session: CallSession | null = null;
  ws.on("close", (code: number) => dbg(`media WS closed code=${code} session=${!!session}`));
  ws.on("error", (e: Error) => dbg(`media WS error: ${e.message}`));

  const onFirst = (raw: Buffer) => {
    let msg: any;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      dbg("media WS: unparseable first frame");
      return;
    }
    dbg(`media WS frame event=${msg.event}`);
    if (msg.event !== "start") return; // ignore "connected" preamble
    ws.off("message", onFirst);
    const taskId = msg.start.customParameters?.taskId ?? "";
    const task = tasks.get(taskId);
    if (!task) {
      app.log.warn(`media stream for unknown task ${taskId}`);
      ws.close();
      return;
    }
    const rec = task.calls.find((c) => c.callSid === msg.start.callSid);
    if (!rec) {
      dbg(`media stream callSid ${msg.start.callSid} does not match any call on ${taskId} — rejecting`);
      ws.close();
      return;
    }
    session = new CallSession(
      ws,
      task.brief,
      (m) => app.log.info(`[${taskId}] ${m}`),
      (transcript) => {
        if (rec) rec.transcript = transcript;
        if (task.calls.every((c) => c.transcript.length || ["failed", "no-answer", "busy", "completed"].includes(c.status))) {
          task.status = "completed";
        }
        dbg(`[${taskId}] call finished, ${transcript.length} transcript entries`);
        if (rec) {
          extractEvidence(task.brief, transcript)
            .then((ev) => { rec.evidence = ev; dbg(`[${taskId}] evidence extracted: ${ev.outcome}`); })
            .catch((e) => dbg(`[${taskId}] extraction error: ${e.message}`));
        }
      }
    );
    session.handleMessage(raw.toString()); // replay the start frame we consumed
  };
  ws.on("message", onFirst);
});

const port = Number(process.env.PORT ?? 3001);
await app.listen({ port, host: "0.0.0.0" });

import "dotenv/config";
import Fastify from "fastify";
import websocket from "@fastify/websocket";
import formbody from "@fastify/formbody";
import { randomUUID } from "node:crypto";
import { BriefSchema, type Brief } from "./brief.js";
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

process.on("uncaughtException", (e) => dbg(`uncaughtException: ${e.message}`));
process.on("unhandledRejection", (e) => dbg(`unhandledRejection: ${(e as Error)?.message ?? e}`));

app.get("/health", async () => ({ ok: true, tasks: tasks.size, uptime: process.uptime() }));
app.get("/debug", async () => ({ uptime: process.uptime(), events: debugRing }));

// API-key gate on mutating routes. Twilio webhooks (/twiml, /call-status,
// /media) and read-only result pages stay open by design.
app.addHook("onRequest", async (req, reply) => {
  const mutating = req.method === "POST" && req.url.startsWith("/v1/");
  if (!mutating) return;
  const key = process.env.RINGTASK_API_KEY;
  if (!key) return; // no key configured (local dev) — open
  if (req.headers["x-api-key"] !== key) {
    return reply.code(401).send({ error: "invalid or missing x-api-key" });
  }
});

// ---- Task API -------------------------------------------------------------

app.post("/v1/tasks", async (req, reply) => {
  const parsed = BriefSchema.safeParse(req.body);
  if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
  const task: Task = { taskId: `task_${randomUUID().slice(0, 8)}`, brief: parsed.data, status: "created", calls: [] };
  tasks.set(task.taskId, task);
  return { taskId: task.taskId, status: task.status, normalizedBrief: task.brief };
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
  reply.type("text/html").send(renderResultPage(task.taskId, task.brief, task.status, task.calls));
});

// ---- Twilio webhooks ------------------------------------------------------

app.all("/twiml", async (req, reply) => {
  const taskId = (req.query as any).taskId ?? "";
  dbg(`twiml served for ${taskId}`);
  reply.type("text/xml").send(twimlForStream(taskId));
});

const RETRY_DELAY_MS = Number(process.env.RETRY_DELAY_MS ?? 120_000);

app.post("/call-status", async (req) => {
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
    const rec = task.calls.find((c) => c.callSid === msg.start.callSid) ?? task.calls[task.calls.length - 1];
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

import "dotenv/config";
import Fastify from "fastify";
import websocket from "@fastify/websocket";
import formbody from "@fastify/formbody";
import { randomUUID } from "node:crypto";
import { BriefSchema, type Brief } from "./brief.js";
import { placeCall, twimlForStream } from "./telephony/twilio.js";
import { CallSession, type TranscriptEntry } from "./call/session.js";

interface CallRecord {
  callSid?: string;
  to: string;
  status: string;
  transcript: TranscriptEntry[];
  startedAt: string;
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

process.on("uncaughtException", (e) => app.log.error(e, "uncaughtException"));
process.on("unhandledRejection", (e) => app.log.error(e as Error, "unhandledRejection"));

app.get("/health", async () => ({ ok: true, tasks: tasks.size, uptime: process.uptime() }));

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
  if (task.calls.length >= task.brief.maxBusinesses) {
    return reply.code(400).send({ error: `task limited to ${task.brief.maxBusinesses} calls` });
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

// ---- Twilio webhooks ------------------------------------------------------

app.all("/twiml", async (req, reply) => {
  const taskId = (req.query as any).taskId ?? "";
  reply.type("text/xml").send(twimlForStream(taskId));
});

app.post("/call-status", async (req) => {
  const body = req.body as any;
  const task = tasks.get((req.query as any).taskId ?? "");
  const rec = task?.calls.find((c) => c.callSid === body.CallSid);
  if (rec) rec.status = body.CallStatus;
  app.log.info({ callSid: body.CallSid, status: body.CallStatus }, "call status");
  return "ok";
});

// ---- Media stream ---------------------------------------------------------

app.get("/media", { websocket: true }, (ws) => {
  let session: CallSession | null = null;

  const onFirst = (raw: Buffer) => {
    let msg: any;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return;
    }
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
        app.log.info(`[${taskId}] call finished, ${transcript.length} transcript entries`);
      }
    );
    session.handleMessage(raw.toString()); // replay the start frame we consumed
  };
  ws.on("message", onFirst);
});

const port = Number(process.env.PORT ?? 3001);
await app.listen({ port, host: "0.0.0.0" });

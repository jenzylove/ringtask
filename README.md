# RingTask

**Real phone calls for AI agents.** RingTask dials local businesses over the public telephone network, holds a live conversation, and returns evidence-backed structured answers — price, availability, timing, conditions — with every claim linked to a verbatim transcript quote.

Built for the OKX.AI Genesis Hackathon. First phone-calling ASP on the OKX agent marketplace at time of submission.

## Why

Most useful local businesses have no API. Stock, prices, same-day availability, and warranties live only on the other end of a phone call — a place digital agents cannot reach. RingTask is the execution bridge: users and other AI agents hire it per task to make up to 3 calls, complete one bounded errand, and prove what was said.

## Architecture (self-hosted — no Vapi/Retell)

```
User / caller agent
      │  POST /v1/tasks (brief)        x-api-key
      │  POST /v1/tasks/:id/call
      ▼
RingTask server (Fastify, TypeScript)
      ├─ brief validator (zod) + immutable safety policy
      ├─ task state machine (statuses, one auto-retry on no-answer/busy)
      ├─ evidence extractor (quote-verified, numeric cross-check)
      └─ result surfaces:  /t/:id (redacted HTML) · GET /v1/tasks/:id (JSON)
      │
      │  Twilio webhooks (signature-validated) + Media Streams WS
      ▼
Twilio Programmable Voice ──► recipient's real phone
      ▲
      │  8kHz μ-law audio, both directions
      ▼
Realtime voice loop (src/call/session.ts)
      ├─ Deepgram streaming STT (VAD, utterance-end turn detection)
      ├─ Groq llama-3.3-70b (brief-bounded conversation turns)
      ├─ ElevenLabs streaming TTS (native μ-law output)
      └─ barge-in: caller speech cancels agent audio AND in-flight turns
```

## Safety design

- Discloses "automated assistant" in the first sentence of every call — required by immutable server policy, not the task author.
- Forbidden actions (payments, card details, OTPs/passwords, claiming to be human, impersonation) are enforced server-side and **cannot be removed via the API**.
- Allowed actions are a small reviewed enum (`hold appointment`, `hold item`, `open support case`).
- Hard 5-minute per-call deadline; calls end on STT failure rather than hanging silent.
- Max 3 businesses per task; destination numbers must be E.164.
- Every API route requires `x-api-key`; Twilio callbacks are signature-validated; media streams must match a known CallSid.
- Result pages redact destination numbers.

## Evidence integrity

Extraction (post-call, temperature 0) must cite a transcript line index for every answer. The server then verifies: the cited line exists, is a **caller** turn, and — for numeric claims — contains the claimed digits. Anything failing verification is downgraded to `unconfirmed`. Unanswered questions stay `unanswered`; the call outcome is honest (`confirmed` / `partial` / `declined` / `failed` / `no_answer`).

## Run

```bash
npm install
cp .env.example .env   # fill in keys
npm run start
```

- `POST /v1/tasks` — create a task from a brief (goal, location, maxPrice, requiredAnswers, allowedActions)
- `POST /v1/tasks/:id/call` — `{ "to": "+234..." }` places a real call
- `GET /v1/tasks/:id` — full state + transcripts (key-gated)
- `GET /t/:taskId` — shareable evidence page (redacted)
- `GET /` — web form

`PUBLIC_HOST` must be a public https host reachable by Twilio.

## Known limitations (hackathon scope)

- Task state is in-memory; a restart clears it (persistence is post-hackathon work).
- Transcript records the full generated agent line even if the caller interrupted playback partway.
- Business discovery is manual (numbers supplied per task); directory integration is designed but not wired.
- No automated test suite yet; `scripts/fake-call.mjs` exercises the full voice loop against a running server, `scripts/test-extract.ts` exercises extraction against a real-call fixture (not committed, for privacy).
- Dependency advisories in Fastify 4's `fast-uri` are noted, pending the Fastify 5 migration.

# RingTask

An agent that makes real phone calls to complete bounded local errands — and returns evidence-backed structured results.

Self-hosted realtime voice stack (no Vapi/Retell): Twilio Media Streams ↔ Deepgram streaming STT ↔ Groq LLM ↔ ElevenLabs TTS, with barge-in, turn detection, and brief-bounded permissions.

## Run

```bash
npm install
cp .env.example .env   # fill in keys
npm run start
```

Create a task, then place a call:

```bash
POST /v1/tasks          # body: brief (goal, location, maxPrice, requiredAnswers, ...)
POST /v1/tasks/:id/call # body: { "to": "+234..." }
GET  /v1/tasks/:id      # status + transcript evidence
```

`PUBLIC_HOST` must be a public https host reachable by Twilio (cloud deploy or tunnel).

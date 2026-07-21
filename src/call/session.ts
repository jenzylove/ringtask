import type WebSocket from "ws";
import { DeepgramStt } from "../stt/deepgram.js";
import { chatTurn, type ChatMessage } from "../llm/groq.js";
import { synthesizeUlaw } from "../tts/elevenlabs.js";
import { systemPromptFor, type Brief } from "../brief.js";

export interface TranscriptEntry {
  role: "agent" | "caller";
  text: string;
  at: string; // ISO timestamp — evidence spans point at these entries
}

export type CallOutcome = "confirmed" | "partial" | "no_answer" | "declined" | "failed" | "blocked";

const END_TOKEN = "<END_CALL>";

/**
 * One live phone conversation: bridges a Twilio Media Streams
 * websocket with Deepgram STT, the LLM, and streaming TTS.
 *
 * Turn-taking: caller audio -> Deepgram finals accumulate into a
 * pending utterance; UtteranceEnd (or endpointing silence) commits
 * it as the caller's turn and triggers an LLM+TTS response.
 * Barge-in: caller speech while the agent is speaking aborts TTS
 * and clears Twilio's playback buffer.
 */
export class CallSession {
  readonly transcript: TranscriptEntry[] = [];
  private streamSid = "";
  private stt: DeepgramStt;
  private history: ChatMessage[];
  private pendingUtterance: string[] = [];
  private queuedTurn: string | null = null; // caller turn finalized while a response was in flight
  private speaking = false; // agent audio currently being sent
  private thinking = false; // LLM/TTS turn in flight
  private ttsAbort: AbortController | null = null;
  private closed = false;
  private endRequested = false;
  private deadline?: NodeJS.Timeout;

  constructor(
    private twilioWs: WebSocket,
    private brief: Brief,
    private log: (msg: string) => void,
    private onDone: (t: TranscriptEntry[]) => void
  ) {
    this.history = [{ role: "system", content: systemPromptFor(brief) }];
    this.stt = new DeepgramStt({
      onSpeechStarted: () => this.bargeIn(),
      onFinal: (text) => {
        this.bargeIn();
        this.pendingUtterance.push(text);
      },
      onUtteranceEnd: () => void this.commitCallerTurn(),
      onError: (e) => {
        this.log(`deepgram error: ${e.message} — ending call`);
        this.hangup();
      }
    });

    twilioWs.on("message", (raw) => this.handleMessage(raw.toString()));
    twilioWs.on("close", () => this.finish());

    // Hard whole-call deadline: never leave a connected call open past this.
    const maxMs = Number(process.env.MAX_CALL_MS ?? 300_000);
    this.deadline = setTimeout(() => {
      this.log(`max call duration ${maxMs}ms reached — hanging up`);
      this.hangup();
    }, maxMs);
  }

  /** Public so the server can replay the buffered "start" frame it consumed to route the connection. */
  handleMessage(raw: string): void {
    let msg: any;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }
    switch (msg.event) {
      case "start":
        this.streamSid = msg.start.streamSid;
        this.log(`stream started ${this.streamSid} (call ${msg.start.callSid})`);
        // Agent speaks first: mandatory automated-assistant disclosure.
        void this.respond();
        break;
      case "media":
        this.stt.sendAudio(Buffer.from(msg.media.payload, "base64"));
        break;
      case "mark":
        if (msg.mark?.name === "turn-end") {
          this.speaking = false;
          if (this.endRequested) this.hangup();
        }
        break;
      case "stop":
        this.finish();
        break;
    }
  }

  /**
   * Caller finished talking — commit their utterance and answer it.
   * If a response is already in flight, the utterance is queued (never
   * discarded) and drained when the in-flight turn settles.
   */
  private async commitCallerTurn(): Promise<void> {
    const text = this.pendingUtterance.join(" ").trim();
    this.pendingUtterance = [];
    if (!text) return;
    this.transcript.push({ role: "caller", text, at: new Date().toISOString() });
    if (this.thinking) {
      this.queuedTurn = this.queuedTurn ? `${this.queuedTurn} ${text}` : text;
      this.ttsAbort?.abort(); // cancel the stale in-flight response
      return;
    }
    this.history.push({ role: "user", content: text });
    await this.respond();
  }

  private async respond(): Promise<void> {
    if (this.closed || this.thinking) return;
    this.thinking = true;
    this.ttsAbort = new AbortController();
    const signal = this.ttsAbort.signal;
    try {
      const raw = await chatTurn(this.history, signal);
      const wantsEnd = raw.includes(END_TOKEN);
      const text = raw.replace(END_TOKEN, "").trim();
      if (text) {
        this.history.push({ role: "assistant", content: text });
        this.transcript.push({ role: "agent", text, at: new Date().toISOString() });
        this.speaking = true;
        for await (const chunk of synthesizeUlaw(text, signal)) {
          if (signal.aborted || this.closed) break;
          this.sendTwilio({
            event: "media",
            streamSid: this.streamSid,
            media: { payload: chunk.toString("base64") }
          });
        }
        // Mark lets Twilio tell us when playback actually finished.
        this.sendTwilio({ event: "mark", streamSid: this.streamSid, mark: { name: "turn-end" } });
      }
      if (wantsEnd) this.endRequested = true;
    } catch (e: any) {
      if (e.name !== "AbortError") this.log(`respond error: ${e.message}`);
    } finally {
      this.thinking = false;
      this.ttsAbort = null;
      // Drain any caller turn that arrived while we were responding.
      if (this.queuedTurn && !this.closed) {
        const queued = this.queuedTurn;
        this.queuedTurn = null;
        this.history.push({ role: "user", content: queued });
        void this.respond();
      }
    }
  }

  /** Caller started speaking while the agent is talking or thinking — yield. */
  private bargeIn(): void {
    if (this.speaking) {
      this.speaking = false;
      this.ttsAbort?.abort();
      this.sendTwilio({ event: "clear", streamSid: this.streamSid });
      this.log("barge-in: cleared agent audio");
    } else if (this.thinking) {
      this.ttsAbort?.abort();
      this.log("barge-in: cancelled in-flight response");
    }
  }

  private hangup(): void {
    this.log("agent ended call");
    this.twilioWs.close();
  }

  private sendTwilio(obj: unknown): void {
    if (this.twilioWs.readyState === this.twilioWs.OPEN) {
      this.twilioWs.send(JSON.stringify(obj));
    }
  }

  private finish(): void {
    if (this.closed) return;
    this.closed = true;
    if (this.deadline) clearTimeout(this.deadline);
    this.stt.close();
    this.ttsAbort?.abort();
    this.onDone(this.transcript);
  }
}

import WebSocket from "ws";

export interface SttEvents {
  onSpeechStarted: () => void;
  /** Final transcript segment (may be partial utterance). */
  onFinal: (text: string) => void;
  /** Deepgram believes the caller finished their utterance. */
  onUtteranceEnd: () => void;
  onError: (err: Error) => void;
}

/**
 * Streaming STT over Deepgram's live API, configured for Twilio's
 * 8kHz mulaw phone audio with VAD + utterance-end events so the
 * session can do turn detection and barge-in.
 */
export class DeepgramStt {
  private ws: WebSocket;
  private keepAlive?: NodeJS.Timeout;

  constructor(events: SttEvents) {
    const params = new URLSearchParams({
      encoding: "mulaw",
      sample_rate: "8000",
      channels: "1",
      model: process.env.DEEPGRAM_MODEL ?? "nova-2-phonecall",
      interim_results: "true",
      smart_format: "true",
      vad_events: "true",
      endpointing: "300",
      utterance_end_ms: "1200"
    });
    this.ws = new WebSocket(`wss://api.deepgram.com/v1/listen?${params}`, {
      headers: { Authorization: `Token ${process.env.DEEPGRAM_API_KEY}` }
    });
    this.ws.on("open", () => {
      this.keepAlive = setInterval(() => {
        if (this.ws.readyState === WebSocket.OPEN) {
          this.ws.send(JSON.stringify({ type: "KeepAlive" }));
        }
      }, 8000);
    });
    this.ws.on("message", (raw) => {
      let msg: any;
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        return;
      }
      if (msg.type === "SpeechStarted") events.onSpeechStarted();
      else if (msg.type === "UtteranceEnd") events.onUtteranceEnd();
      else if (msg.type === "Results") {
        const alt = msg.channel?.alternatives?.[0];
        if (msg.is_final && alt?.transcript?.trim()) events.onFinal(alt.transcript.trim());
      }
    });
    this.ws.on("error", (e) => events.onError(e as Error));
  }

  sendAudio(mulaw: Buffer): void {
    if (this.ws.readyState === WebSocket.OPEN) this.ws.send(mulaw);
  }

  close(): void {
    if (this.keepAlive) clearInterval(this.keepAlive);
    if (this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: "CloseStream" }));
    }
    this.ws.close();
  }
}

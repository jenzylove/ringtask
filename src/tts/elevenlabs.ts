/**
 * Streaming TTS from ElevenLabs directly in Twilio's wire format
 * (mulaw 8kHz), so chunks can be forwarded to the call as they arrive.
 *
 * Returns an async iterable of mulaw audio chunks. Abort via signal
 * for barge-in.
 */
export async function* synthesizeUlaw(text: string, signal: AbortSignal): AsyncGenerator<Buffer> {
  const voiceId = process.env.ELEVENLABS_VOICE_ID ?? "21m00Tcm4TlvDq8ikWAM"; // "Rachel" default
  const res = await fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}/stream?output_format=ulaw_8000&optimize_streaming_latency=3`,
    {
      method: "POST",
      signal,
      headers: {
        "xi-api-key": process.env.ELEVENLABS_API_KEY ?? "",
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        text,
        model_id: process.env.ELEVENLABS_MODEL ?? "eleven_turbo_v2_5"
      })
    }
  );
  if (!res.ok || !res.body) throw new Error(`ElevenLabs ${res.status}: ${await res.text()}`);
  const reader = res.body.getReader();
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value?.length) yield Buffer.from(value);
  }
}

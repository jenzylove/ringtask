export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";

/**
 * One conversational turn. Groq's llama-3.3-70b is fast enough for
 * voice (<400ms typical). Non-streaming: replies are 1-2 sentences,
 * so TTFB gain from streaming is small next to TTS latency.
 */
export async function chatTurn(messages: ChatMessage[], signal?: AbortSignal): Promise<string> {
  const res = await fetch(GROQ_URL, {
    method: "POST",
    signal,
    headers: {
      Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: process.env.GROQ_MODEL ?? "llama-3.3-70b-versatile",
      messages,
      temperature: 0.4,
      max_tokens: 160
    })
  });
  if (!res.ok) throw new Error(`Groq ${res.status}: ${await res.text()}`);
  const data: any = await res.json();
  return data.choices[0].message.content as string;
}

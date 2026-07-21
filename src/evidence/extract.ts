import { chatTurn } from "../llm/groq.js";
import type { Brief } from "../brief.js";
import type { TranscriptEntry, CallOutcome } from "../call/session.js";

export interface ExtractedAnswer {
  question: string;
  answer: string | null;
  status: "confirmed" | "unconfirmed" | "unanswered";
  /** Verbatim caller quote supporting the answer — the evidence span. */
  quote: string | null;
  /** Timestamp of the transcript entry the quote came from. */
  at: string | null;
}

export interface CallEvidence {
  outcome: CallOutcome;
  answers: ExtractedAnswer[];
  summary: string;
}

/**
 * Post-call extraction: pull each required answer out of the transcript
 * with a verbatim supporting quote, then verify every quote actually
 * appears in a caller turn — anything unsupported is downgraded to
 * "unconfirmed". No quote, no fact.
 */
export async function extractEvidence(brief: Brief, transcript: TranscriptEntry[]): Promise<CallEvidence> {
  if (transcript.length === 0) {
    return { outcome: "no_answer", answers: brief.requiredAnswers.map(unanswered), summary: "Call did not connect or no conversation took place." };
  }

  const lines = transcript.map((t, i) => `[${i}] ${t.role}: ${t.text}`).join("\n");
  const raw = await chatTurn([
    {
      role: "system",
      content: `You extract facts from a phone call transcript. Reply with ONLY valid JSON, no markdown fences.

Schema:
{
  "answers": [{ "question": string, "answer": string|null, "status": "confirmed"|"unconfirmed"|"unanswered", "quoteIndex": number|null }],
  "outcome": "confirmed"|"partial"|"declined"|"failed",
  "summary": string
}

Rules:
- One entry per required question, in order.
- "confirmed" ONLY if a caller line states it clearly; quoteIndex = that line's [index]. The line must be role "caller".
- Ambiguous, contradicted, or agent-assumed answers are "unconfirmed".
- Never infer an answer the caller did not say. "outcome" is "confirmed" if all questions confirmed, "partial" if some, "declined" if the caller refused to talk, "failed" otherwise.
- "summary": 1-2 plain sentences of what was established.`
    },
    {
      role: "user",
      content: `Required questions:\n${brief.requiredAnswers.map((q) => `- ${q}`).join("\n")}\n\nTranscript:\n${lines}`
    }
  ], undefined, { maxTokens: 1500, temperature: 0 });

  let parsed: any;
  try {
    // Tolerate fences/preamble: parse the outermost {...} block.
    const start = raw.indexOf("{");
    const end = raw.lastIndexOf("}");
    if (start === -1 || end <= start) throw new Error("no JSON object in output");
    parsed = JSON.parse(raw.slice(start, end + 1));
  } catch (e: any) {
    console.error(`extraction parse failure: ${e.message}; raw output:\n${raw}`);
    return { outcome: "partial", answers: brief.requiredAnswers.map(unanswered), summary: "Extraction failed; raw transcript available." };
  }

  const answers: ExtractedAnswer[] = brief.requiredAnswers.map((q, i) => {
    const a = parsed.answers?.[i] ?? {};
    const idx = typeof a.quoteIndex === "number" ? a.quoteIndex : null;
    const entry = idx !== null && transcript[idx] ? transcript[idx] : null;
    // Evidence check: the cited line must be a real caller turn.
    const supported = entry !== null && entry.role === "caller";
    return {
      question: q,
      answer: a.answer ?? null,
      status: a.status === "confirmed" && supported ? "confirmed" : a.answer ? "unconfirmed" : "unanswered",
      quote: supported ? entry.text : null,
      at: supported ? entry.at : null
    };
  });

  const confirmed = answers.filter((a) => a.status === "confirmed").length;
  const outcome: CallOutcome =
    parsed.outcome === "declined" ? "declined"
    : confirmed === answers.length ? "confirmed"
    : confirmed > 0 ? "partial"
    : "failed";

  return { outcome, answers, summary: typeof parsed.summary === "string" ? parsed.summary : "" };
}

function unanswered(question: string): ExtractedAnswer {
  return { question, answer: null, status: "unanswered", quote: null, at: null };
}

import type { CallEvidence } from "./evidence/extract.js";
import type { Brief } from "./brief.js";
import type { TranscriptEntry } from "./call/session.js";

interface CallView {
  callSid?: string;
  to: string;
  status: string;
  startedAt: string;
  transcript: TranscriptEntry[];
  evidence?: CallEvidence;
}

const esc = (s: unknown) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));

const STATUS_BADGE: Record<string, string> = {
  confirmed: "#0a7d33", partial: "#a86400", unconfirmed: "#a86400",
  unanswered: "#8a8a8a", declined: "#b3261e", failed: "#b3261e", no_answer: "#8a8a8a"
};

export function renderResultPage(taskId: string, brief: Brief, status: string, calls: CallView[]): string {
  const attempted = calls.length;
  const connected = calls.filter((c) => c.transcript.length > 0).length;

  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>RingTask · ${esc(taskId)}</title>
<style>
:root{color-scheme:light dark}
body{font-family:system-ui,sans-serif;max-width:760px;margin:2rem auto;padding:0 1rem;line-height:1.5}
h1{font-size:1.3rem}h2{font-size:1.05rem;margin-top:2rem}
.badge{display:inline-block;padding:.1rem .55rem;border-radius:999px;color:#fff;font-size:.78rem;vertical-align:middle}
.card{border:1px solid color-mix(in srgb,currentColor 18%,transparent);border-radius:10px;padding:1rem 1.2rem;margin:.8rem 0}
.q{font-weight:600}
.quote{border-left:3px solid color-mix(in srgb,currentColor 30%,transparent);padding-left:.7rem;margin:.3rem 0;font-style:italic;opacity:.85}
.meta{font-size:.8rem;opacity:.65}
details{margin-top:.8rem}
.turn{margin:.25rem 0}.turn b{opacity:.7;font-weight:600}
</style></head><body>
<h1>RingTask result <span class="meta">${esc(taskId)}</span></h1>
<p><b>${esc(brief.goal)}</b> — ${esc(brief.location)}${brief.maxPrice ? ` · budget ${esc(brief.maxPrice)} ${esc(brief.currency)}` : ""}</p>
<p>Businesses attempted: <b>${attempted}</b> · Connected: <b>${connected}</b> · Task status: <b>${esc(status)}</b></p>
${calls.map((c) => callCard(c)).join("")}
<p class="meta">Every confirmed fact links to a verbatim caller quote with a timestamp. Unclear answers are marked unconfirmed — RingTask does not present unverified claims as facts.</p>
</body></html>`;
}

function callCard(c: CallView): string {
  const ev = c.evidence;
  const badge = (s: string) => `<span class="badge" style="background:${STATUS_BADGE[s] ?? "#555"}">${esc(s)}</span>`;
  return `<div class="card">
<p><b>${esc(c.to)}</b> ${ev ? badge(ev.outcome) : `<span class="meta">${esc(c.status)}</span>`}
<span class="meta">· ${esc(new Date(c.startedAt).toUTCString())}${c.callSid ? ` · call ${esc(c.callSid)}` : ""}</span></p>
${ev?.summary ? `<p>${esc(ev.summary)}</p>` : ""}
${(ev?.answers ?? []).map((a) => `
  <div style="margin:.6rem 0">
    <div class="q">${esc(a.question)} ${badge(a.status)}</div>
    ${a.answer ? `<div>${esc(a.answer)}</div>` : ""}
    ${a.quote ? `<div class="quote">“${esc(a.quote)}”<div class="meta">caller · ${esc(a.at)}</div></div>` : ""}
  </div>`).join("")}
${c.transcript.length ? `<details><summary>Full transcript (${c.transcript.length} turns)</summary>
${c.transcript.map((t) => `<div class="turn"><b>${t.role === "agent" ? "RingTask" : "Caller"}:</b> ${esc(t.text)}</div>`).join("")}
</details>` : ""}
</div>`;
}

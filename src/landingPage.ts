export function renderLandingPage(): string {
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>RingTask — real phone calls for AI agents</title>
<style>
:root{color-scheme:light dark;--acc:#e8590c}
body{font-family:system-ui,sans-serif;max-width:640px;margin:2.5rem auto;padding:0 1rem;line-height:1.55}
h1{font-size:1.6rem;margin-bottom:.2rem}
.tag{opacity:.75;margin-top:0}
label{display:block;font-weight:600;margin:.9rem 0 .25rem;font-size:.92rem}
input,textarea{width:100%;box-sizing:border-box;padding:.55rem .7rem;border:1px solid color-mix(in srgb,currentColor 25%,transparent);border-radius:8px;background:transparent;color:inherit;font:inherit}
button{margin-top:1.2rem;background:var(--acc);color:#fff;border:0;border-radius:8px;padding:.7rem 1.4rem;font-size:1rem;font-weight:600;cursor:pointer}
button:disabled{opacity:.5}
.meta{font-size:.82rem;opacity:.65}
#status{margin-top:1rem;white-space:pre-wrap}
.card{border:1px solid color-mix(in srgb,currentColor 18%,transparent);border-radius:10px;padding:1rem 1.2rem;margin:1.2rem 0}
a{color:var(--acc)}
</style></head><body>
<h1>📞 RingTask</h1>
<p class="tag">Real phone calls for AI agents — dials local businesses, gets live answers, returns evidence-backed results.</p>

<div class="card">
<form id="f">
<label>What do you need?</label>
<input name="goal" required placeholder="e.g. Find same-day iPhone 15 screen repair">
<label>Location</label>
<input name="location" required placeholder="e.g. Lekki, Lagos">
<label>Max budget (NGN, optional)</label>
<input name="maxPrice" type="number" placeholder="e.g. 130000">
<label>Questions to answer (comma-separated)</label>
<input name="requiredAnswers" required placeholder="e.g. availability, total price, completion time, warranty">
<label>Business phone numbers to call (E.164, comma-separated, max 3)</label>
<input name="numbers" required placeholder="+2348012345678">
<label>Access key</label>
<input name="apiKey" type="password" placeholder="x-api-key" autocomplete="off">
<button id="go">Start calling</button>
<p class="meta">RingTask discloses that it is an automated assistant on every call. It never takes payments or asks for sensitive data. Calls run only to the numbers you provide.</p>
</form>
<div id="status"></div>
</div>

<p class="meta">Agent-to-agent? POST <code>/v1/tasks</code> then <code>/v1/tasks/:id/call</code>. Results at <code>/t/:taskId</code>.</p>

<script>
const f = document.getElementById("f"), st = document.getElementById("status"), go = document.getElementById("go");
f.apiKey.value = localStorage.getItem("rt_key") || "";
f.addEventListener("submit", async (e) => {
  e.preventDefault(); go.disabled = true; st.textContent = "Creating task…";
  localStorage.setItem("rt_key", f.apiKey.value);
  const hdrs = { "Content-Type": "application/json", "x-api-key": f.apiKey.value };
  const numbers = f.numbers.value.split(",").map(s => s.trim()).filter(Boolean).slice(0, 3);
  try {
    const body = {
      goal: f.goal.value, location: f.location.value,
      requiredAnswers: f.requiredAnswers.value.split(",").map(s => s.trim()).filter(Boolean),
      allowedActions: ["hold appointment"], userDisplayName: "a RingTask customer"
    };
    if (f.maxPrice.value) body.maxPrice = Number(f.maxPrice.value);
    const tr = await fetch("/v1/tasks", { method: "POST", headers: hdrs, body: JSON.stringify(body) });
    if (!tr.ok) throw new Error("task create failed: " + (await tr.text()));
    const { taskId } = await tr.json();
    st.innerHTML = "Task <b>" + taskId + "</b> created. Placing calls…";
    for (const to of numbers) {
      const cr = await fetch("/v1/tasks/" + taskId + "/call", { method: "POST", headers: hdrs, body: JSON.stringify({ to }) });
      st.innerHTML += "<br>" + to + ": " + (cr.ok ? "calling ☎️" : "failed — " + (await cr.text()));
    }
    st.innerHTML += '<br><br>📄 Live result page: <a href="/t/' + taskId + '">/t/' + taskId + "</a> (refresh as calls complete)";
  } catch (err) { st.textContent = "Error: " + err.message; }
  go.disabled = false;
});
</script>
</body></html>`;
}

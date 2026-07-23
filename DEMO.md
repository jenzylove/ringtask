# RingTask — 90-second demo script & shot list

**Goal of the video:** prove RingTask does the one thing other agents can't — reach into the
offline world through a *real* phone call — and return a result a judge can verify, all paid
for natively on OKX. Win angle: **Best Product**. Fallbacks: Software Utility / Lifestyle.

**The two things every second must serve:** (1) the *wow* — a real business answers an
unscripted call and the agent handles it; (2) the *win* — the structured, evidence-backed
result with a real Twilio Call SID. Everything else is glue.

**Hard rule:** you may compress elapsed time (cut ring time, hold music, dead air) but you
may **not** fabricate any call, answer, business, price, or confirmation. Real call, real
recipient, real SID, or it doesn't go in.

---

## The 5 beats (target 90s)

| # | Time | On screen | Voiceover (read tight) |
|---|------|-----------|------------------------|
| 1 · Hook | 0:00–0:12 | Split screen: an AI agent chat window on the left completing tasks (swap, search, book) then hitting a wall at "call the shop to check stock." Freeze on the wall. | "AI agents can search, pay, and trade on-chain. But the moment a task needs a real phone call to a local business, they stop. **RingTask** is the bridge." |
| 2 · Task + OKX pay | 0:12–0:26 | The RingTask landing form: type the goal ("same-day iPhone 15 screen repair, under ₦130k, near Lekki, ask about warranty"). Cut to the terminal showing the **x402 402 challenge → payment → 200** (the `payment quote` / paid replay). Flash "1.5 USDT · X Layer". | "A user — or another agent — hands RingTask a goal and its limits, and pays once through OKX's x402 rail. One-and-a-half USDT. No key exchange, no subscription." |
| 3 · The live call (the WOW) | 0:26–0:56 | **Screen-record a real phone** receiving the call. Audio up. Show the agent open with its disclosure ("I'm an automated assistant calling on behalf of a customer…"), the shopkeeper answer an **unscripted** question, the agent confirm the price back ("so that's one hundred twenty thousand naira, correct?"). Caption the turns as they happen. | *(let the real call audio carry this section — minimal VO)* "It calls the shop itself. It says it's an automated assistant. And it holds a real, unscripted conversation." |
| 4 · The evidence (the WIN) | 0:56–1:15 | The `/t/:taskId` result page: **Attempted 3 · Connected 2**, best option card (price, available today, warranty), each fact under a **verbatim caller quote + timestamp**. Then cut to the **Twilio console** showing the matching **Call SID + duration** — third-party proof. | "Then it returns a structured result — every confirmed fact linked to the exact words the shop said, with the real carrier Call ID to prove the call happened. Unclear answers are marked unconfirmed, never invented." |
| 5 · Close + differentiator | 1:15–1:30 | The OKX marketplace listing for **RingTask #7224** (two services, avatar). End card: "RingTask — real phone calls for AI agents." | "We built the whole realtime voice stack ourselves — no Vapi, no Retell. Search finds the shops. **RingTask finds what's actually available today.**" |

---

## Recording order (shoot out of sequence, assemble after)

1. **The real call first** — it's the hardest to get clean; everything else is easy reshoots.
   - Best case: Twilio account upgraded ($20) → dial a **real business** you have consent from.
   - Fallback: a friend/relative acting as a genuine shopkeeper on your verified number. Still a
     real, unscripted call — just note "recipient consented" in the submission (required anyway).
   - Do 3–4 takes. You want one where: disclosure is clear, they ask something unscripted, the
     agent confirms a number back, and it ends politely. Rough audio is fine — it reads as real.
2. **Grab the evidence page + Twilio console** for *that same call* (same SID must match on screen).
3. **Screen-record the form + the x402 terminal flow** (I can give you the exact commands to run
   on camera so the 402 → pay → 200 is visible).
4. **Screencap the marketplace listing** once #7224 is approved (or the "under review" listing page
   if approval hasn't landed by record day — still shows it's a real ASP).
5. **Record VO last**, over the assembled cut, so timing lines up.

## Do / Don't

- **Do** keep the real call audio front and center — it's the whole moat.
- **Do** show the real Twilio Call SID next to the evidence page. That single frame answers
  "how do we know the call was real?"
- **Do** trim the Twilio trial "press a key" notice out of the cut if you haven't upgraded (it's
  a trial watermark, not the product — cutting it isn't fabrication).
- **Don't** stage or script the shopkeeper's answers. If they fumble, that's *good* — it proves
  unscripted handling.
- **Don't** show your API key, wallet private material, or the `.env`.
- **Don't** claim "first AI phone agent" (Duplex exists). Claim what's true: **first phone-calling
  ASP on the OKX marketplace, with bounded permissions and evidence-backed results.**

## One-line captions to overlay (optional but strong)

- On the call: `Real PSTN call · self-hosted voice stack · no Vapi`
- On the evidence: `Every fact → verbatim quote + real Twilio Call SID`
- On the pay: `Paid once via OKX x402 · 1.5 USDT on X Layer`

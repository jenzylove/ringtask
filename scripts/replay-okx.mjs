// Takes the JSON stdout of `onchainos payment pay-local` (argv[2]),
// assembles the x402 PAYMENT-SIGNATURE header, and replays it to the
// live endpoint. Proves OKX's own reference client + our endpoint agree.
const raw = process.argv[2];
const url = process.argv[3] ?? "https://ringtask.onrender.com/v1/tasks";
const d = JSON.parse(raw).data;
console.log("payer signed by OKX client:", d.authorization.from);

const header = Buffer.from(JSON.stringify({
  x402Version: 1, scheme: "exact", network: "eip155:196",
  payload: { signature: d.signature, authorization: d.authorization }
})).toString("base64");

const res = await fetch(url, {
  method: "POST",
  headers: { "Content-Type": "application/json", "PAYMENT-SIGNATURE": header },
  body: JSON.stringify({ goal: "Find a plumber available this weekend", location: "Surulere, Lagos", requiredAnswers: ["availability", "callout fee"] })
});
console.log("HTTP", res.status);
const receipt = res.headers.get("payment-response");
console.log("PAYMENT-RESPONSE receipt:", receipt ? Buffer.from(receipt, "base64").toString() : "(none)");
const body = await res.json();
console.log("taskId   :", body.taskId ?? "(none)");
console.log("resultUrl:", body.resultUrl ?? "(none)");
if (res.status !== 200) console.log("body:", JSON.stringify(body).slice(0, 300));

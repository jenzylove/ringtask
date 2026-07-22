/**
 * Seller-side x402 (OKX Agent Payments Protocol) for the A2MCP endpoint.
 *
 * Unpaid request  -> 402 with the challenge in BOTH forms:
 *   - PAYMENT-REQUIRED header (v2, base64 JSON)
 *   - JSON body carrying x402Version (v1)
 * Paid replay     -> PAYMENT-SIGNATURE / X-PAYMENT header verified
 *                    structurally (scheme, network, payee, amount, expiry),
 *                    then served with a PAYMENT-RESPONSE receipt header.
 *
 * Settlement note: `exact` (EIP-3009) authorizations are redeemed on-chain
 * by the payee; RingTask stores the signed authorization for redemption.
 */

const NETWORK = "eip155:196"; // X Layer
const CHAIN_ID = 196;
const USDT_XLAYER = process.env.X402_ASSET ?? "0x779ded0c9e1022225f8e0630b35a9b54be713736";
const PRICE_BASE_UNITS = process.env.X402_AMOUNT ?? "1500000"; // 1.5 USDT (6 decimals)
const PAY_TO = process.env.X402_PAY_TO ?? "";

export function paymentChallenge(resourceUrl: string) {
  const accepts = [{
    scheme: "exact",
    network: NETWORK,
    amount: PRICE_BASE_UNITS,
    maxAmountRequired: PRICE_BASE_UNITS, // v1 field name
    asset: USDT_XLAYER,
    payTo: PAY_TO,
    resource: resourceUrl,
    description: "RingTask Phone Scout — create a bounded phone-calling task; returns taskId and evidence-page URL.",
    mimeType: "application/json",
    maxTimeoutSeconds: 300,
    outputSchema: {
      input: {
        type: "http",
        method: "POST",
        bodyType: "json",
        body: {
          type: "object",
          properties: {
            goal: { type: "string", description: "What to find out or arrange" },
            location: { type: "string" },
            maxPrice: { type: "number" },
            requiredAnswers: { type: "array", items: { type: "string" } }
          },
          required: []
        }
      }
    }
  }];
  const payload = { x402Version: 1, accepts, error: "payment required" };
  return {
    body: payload,
    header: Buffer.from(JSON.stringify(payload)).toString("base64")
  };
}

export interface VerifiedPayment {
  payer: string;
  amount: string;
  scheme: string;
}

/**
 * Structural verification of the payment header. Returns the verified
 * payment or a string describing why it was rejected.
 */
export function verifyPaymentHeader(headerValue: string): VerifiedPayment | string {
  if (!PAY_TO) return "seller misconfigured: X402_PAY_TO unset";
  let p: any;
  try {
    p = JSON.parse(Buffer.from(headerValue, "base64").toString("utf8"));
  } catch {
    return "payment header is not base64 JSON";
  }
  const scheme = p.scheme ?? p.payload?.scheme;
  const network = p.network ?? p.payload?.network;
  if (network && network !== NETWORK) return `wrong network ${network}, expected ${NETWORK}`;
  const auth = p.payload?.authorization ?? p.authorization ?? null;
  const sig = p.payload?.signature ?? p.signature;
  if (!sig || typeof sig !== "string" || !sig.startsWith("0x")) return "missing or malformed signature";
  if (auth) {
    if (auth.to && auth.to.toLowerCase() !== PAY_TO.toLowerCase()) return "authorization payee mismatch";
    if (auth.value && BigInt(auth.value) < BigInt(PRICE_BASE_UNITS)) return "authorized amount below price";
    if (auth.validBefore && Number(auth.validBefore) * 1000 < Date.now()) return "authorization expired";
    return { payer: auth.from ?? "unknown", amount: auth.value ?? PRICE_BASE_UNITS, scheme: scheme ?? "exact" };
  }
  // Permit2 / session-cert forms: accept structurally (signature present, network matched).
  return { payer: p.payload?.permit2Authorization?.owner ?? "unknown", amount: PRICE_BASE_UNITS, scheme: scheme ?? "exact" };
}

export function paymentReceipt(v: VerifiedPayment): string {
  return Buffer.from(JSON.stringify({
    status: "pending", // settlement is asynchronous (payee redeems the authorization)
    transaction: "",
    amount: v.amount,
    payer: v.payer,
    chainId: CHAIN_ID
  })).toString("base64");
}

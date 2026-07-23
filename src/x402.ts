/**
 * Seller-side x402 (OKX Agent Payments Protocol).
 *
 * Unpaid request  -> 402 with the challenge in BOTH forms:
 *   - PAYMENT-REQUIRED header (v2, base64 JSON)
 *   - JSON body carrying x402Version (v1)
 * Paid replay     -> PAYMENT-SIGNATURE / X-PAYMENT verified:
 *   - EIP-3009 (`exact`) signatures are cryptographically recovered and
 *     must match the claimed payer (EIP-712 domain = the extra.name/version
 *     we declare in the challenge — the buyer CLI signs with the same).
 *   - Replay protection: each authorization nonce / signature is accepted
 *     exactly once.
 * Then served with a PAYMENT-RESPONSE receipt header. `exact`
 * authorizations are redeemed on-chain by the payee out-of-band.
 */
import { verifyTypedData, TypedDataEncoder } from "ethers";

const NETWORK = "eip155:196"; // X Layer
const CHAIN_ID = 196;
const USDT_XLAYER = process.env.X402_ASSET ?? "0x779ded0c9e1022225f8e0630b35a9b54be713736";
// EIP-712 domain name is the token's ON-CHAIN name() — "USD₮0" (U+20AE),
// NOT "USDT". A real x402 `exact` client derives its signing domain from
// the token itself, so this must match byte-for-byte or ecrecover yields
// the wrong address ("signature does not recover to payer").
const ASSET_NAME = process.env.X402_ASSET_NAME ?? "USD₮0";
const ASSET_VERSION = process.env.X402_ASSET_VERSION ?? "1";
const PAY_TO = process.env.X402_PAY_TO ?? "";

/** The token's real on-chain DOMAIN_SEPARATOR (queried from X Layer). */
export const ONCHAIN_DOMAIN_SEPARATOR =
  "0xd591d9baf744328d9400b923cb02c9474d367d591ca1ab24d8c4068be527599d";

/** The EIP-712 domain we sign/verify under — must reproduce the token's separator. */
export const PAYMENT_DOMAIN = {
  name: ASSET_NAME,
  version: ASSET_VERSION,
  chainId: CHAIN_ID,
  verifyingContract: USDT_XLAYER
};

/** True iff our domain reproduces the token's on-chain DOMAIN_SEPARATOR. */
export function domainMatchesChain(): boolean {
  return TypedDataEncoder.hashDomain(PAYMENT_DOMAIN).toLowerCase() === ONCHAIN_DOMAIN_SEPARATOR.toLowerCase();
}

export interface ServiceOffer {
  amountBaseUnits: string; // 6-decimals USDT
  description: string;
  bodySchema: Record<string, unknown>;
}

export function paymentChallenge(resourceUrl: string, offer: ServiceOffer) {
  const accepts = [{
    scheme: "exact",
    network: NETWORK,
    amount: offer.amountBaseUnits,
    maxAmountRequired: offer.amountBaseUnits, // v1 field name
    asset: USDT_XLAYER,
    payTo: PAY_TO,
    resource: resourceUrl,
    description: offer.description,
    mimeType: "application/json",
    maxTimeoutSeconds: 300,
    extra: { name: ASSET_NAME, version: ASSET_VERSION },
    outputSchema: {
      input: { type: "http", method: "POST", bodyType: "json", body: offer.bodySchema }
    }
  }];
  const payload = { x402Version: 1, accepts, error: "payment required" };
  return { body: payload, header: Buffer.from(JSON.stringify(payload)).toString("base64") };
}

export interface VerifiedPayment {
  payer: string;
  amount: string;
  scheme: string;
  verification: "signature-recovered" | "structural";
}

// Replay protection: nonce/signature -> expiry timestamp. Pruned lazily.
// Keys are only marked used on ACCEPTED payments — a rejected attempt
// (e.g. underpaid) must not burn its nonce.
const seen = new Map<string, number>();
function wasSeen(key: string): boolean {
  const now = Date.now();
  for (const [k, exp] of seen) if (exp < now) seen.delete(k);
  return seen.has(key);
}
function markSeen(...keys: string[]): void {
  const exp = Date.now() + 24 * 3600 * 1000;
  for (const k of keys) seen.set(k, exp);
}

const EIP3009_TYPES = {
  TransferWithAuthorization: [
    { name: "from", type: "address" },
    { name: "to", type: "address" },
    { name: "value", type: "uint256" },
    { name: "validAfter", type: "uint256" },
    { name: "validBefore", type: "uint256" },
    { name: "nonce", type: "bytes32" }
  ]
};

/** Verify the payment header. Returns the verified payment or a rejection reason. */
export function verifyPaymentHeader(headerValue: string, requiredAmount: string): VerifiedPayment | string {
  if (!PAY_TO) return "seller misconfigured: X402_PAY_TO unset";
  let p: any;
  try {
    p = JSON.parse(Buffer.from(headerValue, "base64").toString("utf8"));
  } catch {
    return "payment header is not base64 JSON";
  }
  const scheme = p.scheme ?? p.payload?.scheme ?? "exact";
  const network = p.network ?? p.payload?.network;
  if (network && network !== NETWORK) return `wrong network ${network}, expected ${NETWORK}`;
  const sig = p.payload?.signature ?? p.signature;
  if (!sig || typeof sig !== "string" || !/^0x[0-9a-fA-F]{130}$/.test(sig)) return "missing or malformed signature";
  if (wasSeen(sig.toLowerCase())) return "payment replay: signature already used";

  const auth = p.payload?.authorization ?? p.authorization ?? null;
  if (auth) {
    if (!auth.to || auth.to.toLowerCase() !== PAY_TO.toLowerCase()) return "authorization payee mismatch";
    if (!auth.value || BigInt(auth.value) < BigInt(requiredAmount)) return "authorized amount below price";
    if (auth.validBefore && Number(auth.validBefore) * 1000 < Date.now()) return "authorization expired";
    if (auth.nonce && wasSeen(`nonce:${String(auth.nonce).toLowerCase()}`)) return "payment replay: nonce already used";
    // Cryptographic check: the EIP-3009 typed-data signature must recover
    // to the claimed payer, under the domain we declared in the challenge.
    try {
      const recovered = verifyTypedData(
        PAYMENT_DOMAIN,
        EIP3009_TYPES,
        { from: auth.from, to: auth.to, value: auth.value, validAfter: auth.validAfter ?? 0, validBefore: auth.validBefore ?? 0, nonce: auth.nonce ?? "0x" + "0".repeat(64) },
        sig
      );
      if (recovered.toLowerCase() !== String(auth.from).toLowerCase()) {
        return "signature does not recover to payer";
      }
      markSeen(sig.toLowerCase(), ...(auth.nonce ? [`nonce:${String(auth.nonce).toLowerCase()}`] : []));
      return { payer: auth.from, amount: auth.value, scheme, verification: "signature-recovered" };
    } catch (e: any) {
      return `signature verification failed: ${e.message}`;
    }
  }
  // Permit2 / session-cert wire forms: no local recovery possible here;
  // replay-protected structural acceptance (settlement still requires the
  // real authorization to be valid on-chain).
  markSeen(sig.toLowerCase());
  return { payer: p.payload?.permit2Authorization?.owner ?? "unknown", amount: requiredAmount, scheme, verification: "structural" };
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

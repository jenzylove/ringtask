// Payment-verification unit test (XLayer review point 5): catches
// signature-recovery regressions pre-deploy. No network, no funds.
//
// Run: node scripts/test-x402.mjs   (exit 0 = pass, non-zero = fail)
import { Wallet, hexlify, randomBytes } from "ethers";
import { verifyPaymentHeader, domainMatchesChain, PAYMENT_DOMAIN } from "../src/x402.js";

let failures = 0;
const ok = (name) => console.log(`  ✓ ${name}`);
const bad = (name, detail) => { console.log(`  ✗ ${name} — ${detail}`); failures++; };

const TYPES = { TransferWithAuthorization: [
  { name: "from", type: "address" }, { name: "to", type: "address" },
  { name: "value", type: "uint256" }, { name: "validAfter", type: "uint256" },
  { name: "validBefore", type: "uint256" }, { name: "nonce", type: "bytes32" }
]};
const PAY_TO = process.env.X402_PAY_TO;

async function signedHeader(wallet, domainOverride, value = "1500000") {
  const auth = {
    from: wallet.address, to: PAY_TO, value,
    validAfter: 0, validBefore: Math.floor(Date.now() / 1000) + 600,
    nonce: hexlify(randomBytes(32))
  };
  const signature = await wallet.signTypedData(domainOverride ?? PAYMENT_DOMAIN, TYPES, auth);
  return Buffer.from(JSON.stringify({ x402Version: 1, scheme: "exact", network: "eip155:196", payload: { signature, authorization: auth } })).toString("base64");
}

console.log("x402 payment verification tests\n");

// 0. Sanity: X402_PAY_TO must be set for the test to mean anything.
if (!PAY_TO) { console.log("  ! set X402_PAY_TO to run — export X402_PAY_TO=0x5bbc247738d9c44e852dac08de3cbc0bd0a5d718"); process.exit(2); }

// 1. Our EIP-712 domain reproduces the token's on-chain DOMAIN_SEPARATOR.
domainMatchesChain() ? ok("domain matches token's on-chain DOMAIN_SEPARATOR") : bad("domain match", "hashDomain != on-chain separator");

// 2. A payment signed with the CORRECT domain recovers to the payer.
{
  const w = Wallet.createRandom();
  const res = verifyPaymentHeader(await signedHeader(w), "1500000");
  if (typeof res === "string") bad("valid signature accepted", res);
  else if (res.payer.toLowerCase() !== w.address.toLowerCase()) bad("valid signature accepted", `recovered ${res.payer} != ${w.address}`);
  else if (res.verification !== "signature-recovered") bad("valid signature accepted", `verification=${res.verification}`);
  else ok("valid signature recovers to payer");
}

// 3. A payment signed with the WRONG domain name ("USDT") is REJECTED.
//    (This is the exact bug the XLayer team caught.)
{
  const w = Wallet.createRandom();
  const wrong = { ...PAYMENT_DOMAIN, name: "USDT" };
  const res = verifyPaymentHeader(await signedHeader(w, wrong), "1500000");
  typeof res === "string" ? ok('wrong-domain ("USDT") signature rejected') : bad("wrong-domain rejected", "was accepted!");
}

// 4. Replay of the same signature is rejected.
{
  const w = Wallet.createRandom();
  const h = await signedHeader(w);
  const first = verifyPaymentHeader(h, "1500000");
  const second = verifyPaymentHeader(h, "1500000");
  (typeof first !== "string" && typeof second === "string") ? ok("replay rejected") : bad("replay rejected", "second use not rejected");
}

// 5. Underpayment is rejected.
{
  const w = Wallet.createRandom();
  const res = verifyPaymentHeader(await signedHeader(w, undefined, "500000"), "1500000");
  typeof res === "string" ? ok("underpayment rejected") : bad("underpayment rejected", "was accepted");
}

console.log(`\n${failures === 0 ? "PASS" : "FAIL"} — ${failures} failure(s)`);
process.exit(failures === 0 ? 0 : 1);

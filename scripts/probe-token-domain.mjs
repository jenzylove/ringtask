// Diagnose the x402 signature bug: fetch the token's REAL on-chain EIP-712
// domain and check EIP-3009 support. This is the source of truth that a
// real x402 `exact` client uses to build the signing domain.
import { JsonRpcProvider, Contract } from "ethers";

const TOKEN = "0x779ded0c9e1022225f8e0630b35a9b54be713736";
const RPCS = ["https://rpc.xlayer.tech", "https://xlayerrpc.okx.com", "https://xlayer.drpc.org"];

const ABI = [
  "function name() view returns (string)",
  "function version() view returns (string)",
  "function DOMAIN_SEPARATOR() view returns (bytes32)",
  "function eip712Domain() view returns (bytes1 fields, string name, string version, uint256 chainId, address verifyingContract, bytes32 salt, uint256[] extensions)",
  // EIP-3009
  "function authorizationState(address, bytes32) view returns (bool)",
  "function TRANSFER_WITH_AUTHORIZATION_TYPEHASH() view returns (bytes32)"
];

let provider;
for (const url of RPCS) {
  try {
    const p = new JsonRpcProvider(url, 196, { staticNetwork: true });
    await p.getBlockNumber();
    provider = p;
    console.log("RPC:", url, "\n");
    break;
  } catch (e) { console.log("RPC failed:", url, e.shortMessage ?? e.message); }
}
if (!provider) { console.log("no working RPC"); process.exit(1); }

const c = new Contract(TOKEN, ABI, provider);

async function tryCall(label, fn) {
  try { console.log(label, "->", await fn()); }
  catch (e) { console.log(label, "-> NOT AVAILABLE (" + (e.shortMessage ?? e.code ?? e.message) + ")"); }
}

await tryCall("name()   ", () => c.name());
await tryCall("version()", () => c.version());
await tryCall("DOMAIN_SEPARATOR()", () => c.DOMAIN_SEPARATOR());
await tryCall("eip712Domain() [EIP-5267]", async () => {
  const d = await c.eip712Domain();
  return JSON.stringify({ name: d.name, version: d.version, chainId: d.chainId.toString(), verifyingContract: d.verifyingContract });
});
console.log("\n--- EIP-3009 support (required for x402 `exact`) ---");
await tryCall("TRANSFER_WITH_AUTHORIZATION_TYPEHASH()", () => c.TRANSFER_WITH_AUTHORIZATION_TYPEHASH());
await tryCall("authorizationState(0x0, 0x0) [probe]", () => c.authorizationState("0x0000000000000000000000000000000000000000", "0x" + "00".repeat(32)));

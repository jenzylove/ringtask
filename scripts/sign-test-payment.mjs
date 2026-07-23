// Generates a structurally + cryptographically valid x402 `exact` payment
// header signed by a THROWAWAY wallet (no funds — settlement would fail
// on-chain; this exercises the seller's verification path only).
import { Wallet, hexlify, randomBytes } from "ethers";

const amount = process.argv[2] ?? "1500000";
const wallet = Wallet.createRandom();
const auth = {
  from: wallet.address,
  to: "0x5bbc247738d9c44e852dac08de3cbc0bd0a5d718",
  value: amount,
  validAfter: 0,
  validBefore: Math.floor(Date.now() / 1000) + 600,
  nonce: hexlify(randomBytes(32))
};
const signature = await wallet.signTypedData(
  { name: process.env.X402_ASSET_NAME ?? "USD₮0", version: "1", chainId: 196, verifyingContract: "0x779ded0c9e1022225f8e0630b35a9b54be713736" },
  { TransferWithAuthorization: [
    { name: "from", type: "address" }, { name: "to", type: "address" },
    { name: "value", type: "uint256" }, { name: "validAfter", type: "uint256" },
    { name: "validBefore", type: "uint256" }, { name: "nonce", type: "bytes32" }
  ]},
  auth
);
const payload = { x402Version: 1, scheme: "exact", network: "eip155:196", payload: { signature, authorization: auth } };
console.log(Buffer.from(JSON.stringify(payload)).toString("base64"));

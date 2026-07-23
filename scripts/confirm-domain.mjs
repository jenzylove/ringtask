// Confirm the token's exact EIP-712 domain by reproducing its on-chain
// DOMAIN_SEPARATOR. Whichever (name, version) reproduces it is authoritative.
import { TypedDataEncoder } from "ethers";

const TOKEN = "0x779ded0c9e1022225f8e0630b35a9b54be713736";
const ONCHAIN = "0xd591d9baf744328d9400b923cb02c9474d367d591ca1ab24d8c4068be527599d";

for (const name of ["USD₮0", "USDT", "USD₮0"]) {
  for (const version of ["1", "2", "0"]) {
    const sep = TypedDataEncoder.hashDomain({ name, version, chainId: 196, verifyingContract: TOKEN });
    if (sep.toLowerCase() === ONCHAIN.toLowerCase()) {
      console.log(`MATCH  name=${JSON.stringify(name)} version=${JSON.stringify(version)}`);
    } else {
      console.log(`no     name=${JSON.stringify(name)} version=${JSON.stringify(version)} -> ${sep.slice(0, 14)}…`);
    }
  }
}

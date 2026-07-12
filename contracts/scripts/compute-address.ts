import { artifacts } from "hardhat";
import { getCreate2Address, keccak256 } from "viem";

import {
  CONTRACT_NAME,
  CREATE2_FACTORY,
  DEPLOY_SALT,
  EXPLORER_BASE_SEPOLIA,
} from "./constants.js";

async function main() {
  const artifact = await artifacts.readArtifact(CONTRACT_NAME);
  const creationBytecode = artifact.bytecode as `0x${string}`;
  const bytecodeHash = keccak256(creationBytecode);
  const address = getCreate2Address({
    bytecodeHash,
    from: CREATE2_FACTORY,
    salt: DEPLOY_SALT,
  });

  console.log("VincentAnchorRegistry — CREATE2 deterministic deployment");
  console.log("─".repeat(56));
  console.log(`Factory:       ${CREATE2_FACTORY}`);
  console.log(`Salt:          ${DEPLOY_SALT}`);
  console.log(`Bytecode hash: ${bytecodeHash}`);
  console.log(`Address:       ${address}`);
  console.log(`Explorer:      ${EXPLORER_BASE_SEPOLIA}/address/${address}`);
  console.log("─".repeat(56));
  console.log("Run `pnpm deploy:base-sepolia` to deploy on Base Sepolia.");
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});

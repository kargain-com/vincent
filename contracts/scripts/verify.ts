import hre, { artifacts, network } from "hardhat";
import { verifyContract } from "@nomicfoundation/hardhat-verify/verify";
import { getCreate2Address, keccak256 } from "viem";

import {
  CONTRACT_NAME,
  CREATE2_FACTORY,
  DEPLOY_SALT,
  EXPLORER_BASE_SEPOLIA,
} from "./constants.js";

async function main() {
  if (!process.env.ETHERSCAN_API_KEY) {
    throw new Error("ETHERSCAN_API_KEY is required for verification");
  }

  const artifact = await artifacts.readArtifact(CONTRACT_NAME);
  const creationBytecode = artifact.bytecode as `0x${string}`;
  const bytecodeHash = keccak256(creationBytecode);
  const address = getCreate2Address({
    bytecodeHash,
    from: CREATE2_FACTORY,
    salt: DEPLOY_SALT,
  });

  await network.connect({ network: "baseSepolia" });

  console.log(`Verifying ${CONTRACT_NAME} at ${address} on Base Sepolia…`);

  await verifyContract(
    {
      address,
      contract: "src/VincentAnchorRegistry.sol:VincentAnchorRegistry",
    },
    hre,
  );

  console.log(`Verified: ${EXPLORER_BASE_SEPOLIA}/address/${address}#code`);
  console.log("Update the Verified column in docs/contracts/README.md.");
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});

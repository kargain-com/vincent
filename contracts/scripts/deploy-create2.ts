import { artifacts, network } from "hardhat";
import {
  concat,
  getCreate2Address,
  keccak256,
  type Address,
  type PublicClient,
} from "viem";

import {
  CONTRACT_NAME,
  CREATE2_FACTORY,
  DEPLOY_SALT,
  EXPLORER_BASE_SEPOLIA,
} from "./constants.js";

const CODE_POLL_INTERVAL_MS = 2_000;
const CODE_POLL_MAX_ATTEMPTS = 15;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForDeployedCode(
  publicClient: PublicClient,
  address: Address,
): Promise<`0x${string}`> {
  for (let attempt = 1; attempt <= CODE_POLL_MAX_ATTEMPTS; attempt++) {
    const code = await publicClient.getCode({ address });
    if (code && code !== "0x") {
      return code;
    }
    if (attempt < CODE_POLL_MAX_ATTEMPTS) {
      await sleep(CODE_POLL_INTERVAL_MS);
    }
  }
  throw new Error(
    `No code at expected address ${address} after ${CODE_POLL_MAX_ATTEMPTS} polling attempts`,
  );
}

async function main() {
  if (!process.env.BASE_SEPOLIA_RPC_URL) {
    throw new Error("BASE_SEPOLIA_RPC_URL is required");
  }
  if (!process.env.DEPLOYER_PRIVATE_KEY) {
    throw new Error("DEPLOYER_PRIVATE_KEY is required");
  }

  const artifact = await artifacts.readArtifact(CONTRACT_NAME);
  const creationBytecode = artifact.bytecode as `0x${string}`;
  const bytecodeHash = keccak256(creationBytecode);
  const expectedAddress = getCreate2Address({
    bytecodeHash,
    from: CREATE2_FACTORY,
    salt: DEPLOY_SALT,
  });

  const { viem } = await network.connect({ network: "baseSepolia" });
  const publicClient = await viem.getPublicClient();
  const [wallet] = await viem.getWalletClients();

  const factoryCode = await publicClient.getCode({ address: CREATE2_FACTORY });
  if (!factoryCode || factoryCode === "0x") {
    throw new Error(
      `Deterministic deployment proxy not found at ${CREATE2_FACTORY} on this chain. ` +
        `Deploy the factory first via its known keyless deployment transaction ` +
        `(https://github.com/Arachnid/deterministic-deployment-proxy), then retry.`,
    );
  }

  const existingCode = await publicClient.getCode({ address: expectedAddress });
  if (existingCode && existingCode !== "0x") {
    console.log(`Already deployed at ${expectedAddress}`);
    console.log(`${EXPLORER_BASE_SEPOLIA}/address/${expectedAddress}`);
    console.log("Update docs/contracts/README.md if not already recorded.");
    return;
  }

  const deployData = concat([DEPLOY_SALT, creationBytecode]);
  const hash = await wallet.sendTransaction({
    to: CREATE2_FACTORY,
    data: deployData,
  });

  console.log(`Deploy tx: ${hash}`);
  const receipt = await publicClient.waitForTransactionReceipt({ hash });

  if (receipt.status !== "success") {
    throw new Error(`CREATE2 deployment failed (status ${receipt.status})`);
  }

  await waitForDeployedCode(publicClient, expectedAddress);

  console.log("VincentAnchorRegistry deployed via CREATE2");
  console.log(`Address:  ${expectedAddress}`);
  console.log(`Explorer: ${EXPLORER_BASE_SEPOLIA}/address/${expectedAddress}`);
  console.log(`Gas used: ${receipt.gasUsed}`);
  console.log("");
  console.log("Next steps:");
  console.log("  1. Record the address in docs/contracts/README.md");
  console.log("  2. Run: pnpm verify:base-sepolia");
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});

import "dotenv/config";
import hardhatToolboxViem from "@nomicfoundation/hardhat-toolbox-viem";
import hardhatVerify from "@nomicfoundation/hardhat-verify";
import { defineConfig } from "hardhat/config";

export default defineConfig({
  plugins: [hardhatToolboxViem, hardhatVerify],
  solidity: {
    version: "0.8.28",
    settings: {
      optimizer: { enabled: true, runs: 200 },
      evmVersion: "cancun",
      metadata: { bytecodeHash: "none" },
    },
  },
  paths: {
    sources: "./src",
    tests: "./test",
  },
  networks: {
    baseSepolia: {
      type: "http",
      chainId: 84532,
      url: process.env.BASE_SEPOLIA_RPC_URL ?? "http://127.0.0.1:8545",
      accounts: process.env.DEPLOYER_PRIVATE_KEY
        ? [process.env.DEPLOYER_PRIVATE_KEY]
        : [],
    },
  },
  verify: {
    etherscan: {
      apiKey: process.env.ETHERSCAN_API_KEY ?? "",
    },
  },
});

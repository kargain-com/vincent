import hardhatToolboxViem from '@nomicfoundation/hardhat-toolbox-viem';
import { defineConfig } from 'hardhat/config';

export default defineConfig({
  plugins: [hardhatToolboxViem],
  solidity: {
    version: '0.8.28',
    settings: {
      optimizer: { enabled: true, runs: 200 },
      evmVersion: 'cancun',
      metadata: { bytecodeHash: 'none' },
    },
  },
  paths: {
    sources: '../contracts/src',
    artifacts: '../contracts/artifacts',
    cache: '../contracts/cache',
  },
});

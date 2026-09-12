import { defineConfig } from 'hardhat/config';

export default defineConfig({
  solidity: {
    version: '0.8.28',
    settings: {
      evmVersion: 'shanghai',
      optimizer: {
        enabled: true,
        runs: 200,
      },
      viaIR: true,
    },
  },
});

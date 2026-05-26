import type { HardhatUserConfig } from "hardhat/config";
import hardhatIgnitionViem from "@nomicfoundation/hardhat-ignition-viem";
import hardhatKeystore from "@nomicfoundation/hardhat-keystore";
import hardhatMocha from "@nomicfoundation/hardhat-mocha";
import hardhatNetworkHelpers from "@nomicfoundation/hardhat-network-helpers";
import hardhatVerify from "@nomicfoundation/hardhat-verify";
import hardhatViem from "@nomicfoundation/hardhat-viem";
import hardhatViemAssertions from "@nomicfoundation/hardhat-viem-assertions";
import "dotenv/config";

// Hardhat v3 rejects empty strings at config-validation time, so we fall back
// to a public Sepolia RPC when SEPOLIA_RPC_URL isn't set (e.g. CI). This lets
// the config validate cleanly even without a private endpoint, and gives
// ad-hoc developers a working-but-rate-limited default. For production
// deploys, set SEPOLIA_RPC_URL to your own endpoint in `.env`.
const SEPOLIA_RPC_URL = process.env.SEPOLIA_RPC_URL || "https://ethereum-sepolia-rpc.publicnode.com";
const DEPLOYER_PRIVATE_KEY = process.env.DEPLOYER_PRIVATE_KEY ?? "";
const SEPOLIA_ETHERSCAN_API_KEY = process.env.SEPOLIA_ETHERSCAN_API_KEY ?? "";

const config: HardhatUserConfig = {
  plugins: [
    hardhatViem,
    hardhatViemAssertions,
    hardhatNetworkHelpers,
    hardhatMocha,
    hardhatKeystore,
    hardhatIgnitionViem,
    hardhatVerify,
  ],
  solidity: {
    profiles: {
      default: {
        version: "0.8.24",
        settings: {
          optimizer: { enabled: true, runs: 200 },
          evmVersion: "cancun",
        },
      },
    },
  },
  paths: {
    sources: "src",
    tests: "test",
    cache: "cache",
    artifacts: "artifacts",
  },
  networks: {
    hardhatMainnet: {
      type: "edr-simulated",
      chainType: "l1",
    },
    sepolia: {
      type: "http",
      chainType: "l1",
      chainId: 11155111,
      url: SEPOLIA_RPC_URL,
      accounts: DEPLOYER_PRIVATE_KEY ? [DEPLOYER_PRIVATE_KEY] : [],
    },
  },
  verify: {
    etherscan: {
      apiKey: SEPOLIA_ETHERSCAN_API_KEY,
    },
  },
};

export default config;

import { keccak256, toBytes, type Hex } from "viem";

export interface AssetConfig {
  symbol: string;
  description: string;
  decimals: number;
  assetId: Hex;
}

const make = (symbol: string, description: string, decimals = 8): AssetConfig => ({
  symbol,
  description,
  decimals,
  assetId: keccak256(toBytes(symbol)),
});

/// Canonical asset universe for the demo. `assetId` is `keccak256(symbol)` so
/// off-chain services and the frontend derive the same identifier without
/// reading on-chain state.
export const ASSETS: readonly AssetConfig[] = [
  make("WETH", "Wrapped Ether"),
  make("WBTC", "Wrapped Bitcoin"),
  make("LINK", "Chainlink"),
  make("UNI", "Uniswap"),
  make("AAVE", "Aave"),
  make("XAU", "Gold (USD/oz)"),
  make("XAG", "Silver (USD/oz)"),
  make("SPX", "S&P 500 Index"),
  make("WTI", "WTI Crude Oil (USD/bbl)"),
  make("HG", "Copper (USD/lb)"),
] as const;

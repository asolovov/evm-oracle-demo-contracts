import { hashTypedData, type Hex, type WalletClient } from "viem";

export const DOMAIN_NAME = "LIGHTHOUSE_V1";
export const DOMAIN_VERSION = "1";

export const PRICE_TYPES = {
  Price: [
    { name: "reqId", type: "uint256" },
    { name: "assetId", type: "bytes32" },
    { name: "price", type: "int256" },
    { name: "timestamp", type: "uint256" },
  ],
} as const;

export interface PriceMessage {
  reqId: bigint;
  assetId: Hex;
  price: bigint;
  timestamp: bigint;
}

export interface DomainParams {
  chainId: bigint;
  verifyingContract: `0x${string}`;
}

export function buildDigest(domain: DomainParams, message: PriceMessage): Hex {
  return hashTypedData({
    domain: {
      name: DOMAIN_NAME,
      version: DOMAIN_VERSION,
      chainId: Number(domain.chainId),
      verifyingContract: domain.verifyingContract,
    },
    types: PRICE_TYPES,
    primaryType: "Price",
    message,
  });
}

export async function signPrice(
  walletClient: WalletClient,
  account: `0x${string}`,
  domain: DomainParams,
  message: PriceMessage,
): Promise<Hex> {
  return walletClient.signTypedData({
    account,
    domain: {
      name: DOMAIN_NAME,
      version: DOMAIN_VERSION,
      chainId: Number(domain.chainId),
      verifyingContract: domain.verifyingContract,
    },
    types: PRICE_TYPES,
    primaryType: "Price",
    message,
  });
}

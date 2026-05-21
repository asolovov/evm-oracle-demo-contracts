/// Compare two addresses case-insensitively. viem returns checksummed addresses
/// while contract reads return lowercase, so we normalise both sides.
export function sameAddress(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase();
}

export function lower(addr: string): string {
  return addr.toLowerCase();
}

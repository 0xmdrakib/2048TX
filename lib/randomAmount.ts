/**
 * Returns a random USDC amount (as a string with 6 decimals) in:
 * 0.000001 -> 0.000005
 */
export function randomMicroUsdc(): { micro: number; amount: string } {
  const micro = Math.floor(Math.random() * (5 - 1 + 1)) + 1; // 1..5
  return { micro, amount: (micro / 1_000_000).toFixed(6) };
}

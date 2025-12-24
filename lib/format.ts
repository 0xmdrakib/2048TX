export function formatMicroUsdc(micro: number): string {
  const v = micro / 1_000_000;
  return v.toFixed(6);
}

export function shorten(addr: string, left = 6, right = 4) {
  if (addr.length <= left + right) return addr;
  return `${addr.slice(0, left)}…${addr.slice(-right)}`;
}

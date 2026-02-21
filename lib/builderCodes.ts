/**
 * Base Builder Codes (ERC-8021) — minimal, dependency-free implementation.
 *
 * Format (Schema 0 / Canonical Registry), per ERC-8021:
 *   dataSuffix = utf8(codes.join(",")) + uint8(byteLength) + uint8(schemaId=0) + ercMarker
 * where:
 *   ercMarker = 0x80218021802180218021802180218021  (16 bytes)
 *
 * Sources:
 * - Base Builder Codes docs (high level + marker) https://docs.base.org/base-chain/builder-codes/builder-codes
 * - Ox reference implementation example output: https://oxlib.sh/ercs/erc8021/Attribution/toDataSuffix
 */

const ERC8021_MARKER_HEX = "80218021802180218021802180218021" as const;
const SCHEMA_ID_HEX = "00" as const;

function bytesToHex(bytes: Uint8Array): string {
  let out = "";
  for (const b of bytes) out += b.toString(16).padStart(2, "0");
  return out;
}

function buildSchema0Suffix(codes: readonly string[]): `0x${string}` {
  const joined = codes.join(",");
  const bytes = new TextEncoder().encode(joined);
  if (bytes.length > 255) {
    throw new Error("ERC-8021 schema0 only supports up to 255 bytes of codes.");
  }
  const lenHex = bytes.length.toString(16).padStart(2, "0");
  return (`0x${bytesToHex(bytes)}${lenHex}${SCHEMA_ID_HEX}${ERC8021_MARKER_HEX}`) as `0x${string}`;
}

function parseCodesFromEnv(): string[] {
  const rawList = process.env.NEXT_PUBLIC_BUILDER_CODES;
  if (rawList) {
    const codes = rawList
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    if (codes.length) return codes;
  }
  const single = process.env.NEXT_PUBLIC_BUILDER_CODE?.trim();
  return single ? [single] : [];
}

/**
 * Set NEXT_PUBLIC_BUILDER_CODE (single) or NEXT_PUBLIC_BUILDER_CODES (comma-separated)
 * to enable attribution.
 */
export const ERC8021_DATA_SUFFIX: `0x${string}` | undefined = (() => {
  const codes = parseCodesFromEnv();
  if (!codes.length) return undefined;
  return buildSchema0Suffix(codes);
})();

export function hasErc8021Marker(hexData: `0x${string}`): boolean {
  return hexData.toLowerCase().endsWith(ERC8021_MARKER_HEX);
}

/**
 * Appends the ERC-8021 suffix to existing calldata.
 * If the calldata already looks attributed (marker present), it is returned unchanged.
 */
export function appendErc8021Suffix(data: `0x${string}`): `0x${string}` {
  if (!ERC8021_DATA_SUFFIX) return data;
  if (hasErc8021Marker(data)) return data;
  return (`${data}${ERC8021_DATA_SUFFIX.slice(2)}`) as `0x${string}`;
}

import { NextResponse } from "next/server";

export async function GET() {
  const ok = Boolean(process.env.NEXT_PUBLIC_PAY_RECIPIENT) && Boolean(process.env.NEXT_PUBLIC_SCORE_CONTRACT_ADDRESS);
  return NextResponse.json({
    ok,
    hasPayRecipient: Boolean(process.env.NEXT_PUBLIC_PAY_RECIPIENT),
    hasScoreContract: Boolean(process.env.NEXT_PUBLIC_SCORE_CONTRACT_ADDRESS),
    chainId: process.env.NEXT_PUBLIC_CHAIN_ID ?? null,
    testnet: process.env.NEXT_PUBLIC_TESTNET ?? null,
  });
}

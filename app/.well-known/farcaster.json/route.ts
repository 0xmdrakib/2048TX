import { NextResponse } from "next/server";

export const runtime = "edge";

/**
 * Mini App manifest at /.well-known/farcaster.json
 * Replace accountAssociation with the signed object from Farcaster Developer Tools / Base manifest signing.
 * See README for steps.
 */
export async function GET() {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "https://YOUR_DOMAIN_HERE";
  const chain = process.env.NEXT_PUBLIC_REQUIRED_CHAIN ?? "eip155:8453";

  const manifest = {
    accountAssociation: {
      header: "REPLACE_ME",
      payload: "REPLACE_ME",
      signature: "REPLACE_ME",
    },
    miniapp: {
      version: "1",
      name: "2048 TX",
      homeUrl: appUrl,
      iconUrl: `${appUrl}/icon.png`,
      splashImageUrl: `${appUrl}/splash.png`,
      splashBackgroundColor: "#faf8f0",
      subtitle: "2048, but onchain when you want",
      description: "Play classic 2048 or opt into pay-per-move micro USDC payments. Save best score onchain with a single tx.",
      primaryCategory: "games",
      tags: ["games", "2048", "base", "onchain"],
      screenshotUrls: [`${appUrl}/screenshots/screen1.png`],
      noindex: true,
      requiredChains: [chain],
      requiredCapabilities: ["wallet.getEthereumProvider"],
    },
  };

  return NextResponse.json(manifest, {
    headers: { "Cache-Control": "public, max-age=300" },
  });
}

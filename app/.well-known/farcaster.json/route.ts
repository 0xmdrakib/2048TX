import { NextResponse } from "next/server";

export const runtime = "edge";

function stripTrailingSlash(url: string) {
  return url.endsWith("/") ? url.slice(0, -1) : url;
}

function safeHost(url: string) {
  try {
    return new URL(url).host;
  } catch {
    return url.replace(/^https?:\/\//, "").split("/")[0];
  }
}

export async function GET() {
  const appUrlRaw = process.env.NEXT_PUBLIC_APP_URL ?? "https://YOUR_DOMAIN_HERE";
  const appUrl = stripTrailingSlash(appUrlRaw);

  // Base mainnet default
  const chain = process.env.NEXT_PUBLIC_REQUIRED_CHAIN ?? "eip155:8453";

  // Prefer env-driven accountAssociation so you can paste into Vercel env vars
  // after generating via Base Build / Warpcast manifest tools.
  const header = process.env.FARCASTER_HEADER ?? "REPLACE_ME";
  const payload = process.env.FARCASTER_PAYLOAD ?? "REPLACE_ME";
  const signature = process.env.FARCASTER_SIGNATURE ?? "REPLACE_ME";

  const manifest = {
    accountAssociation: { header, payload, signature },
    miniapp: {
      version: "1",
      name: "2048 TX",

      // Identity & launch
      homeUrl: appUrl,
      canonicalDomain: safeHost(appUrl), // optional, but good practice per Farcaster spec :contentReference[oaicite:8]{index=8}

      // Required visuals
      iconUrl: `${appUrl}/icon.png`,
      splashImageUrl: `${appUrl}/splash.png`,
      splashBackgroundColor: "#faf8f0",

      // Base discovery (required by Base schema)
      primaryCategory: "games",
      tags: ["games", "2048", "base", "onchain"],
      tagline: "Do tx while playing 2048",
      heroImageUrl: `${appUrl}/hero.png`,
      screenshotUrls: [
        `${appUrl}/screenshots/screen1.png`,
        // optionally add 2 more:
        // `${appUrl}/screenshots/screen2.png`,
        // `${appUrl}/screenshots/screen3.png`,
      ],

      // Display text
      subtitle: "Onchain when you want",
      description:
        "Play classic 2048 or opt into pay-per-move micro USDC payments. Save best score onchain with a single tx.",

      // Social embeds (optional but recommended)
      ogTitle: "2048 TX",
      ogDescription: "Classic 2048 + optional onchain score + pay-per-move.",
      ogImageUrl: `${appUrl}/hero.png`,

      // Keep hidden during testing
      noindex: true, // recommended for staging/dev :contentReference[oaicite:9]{index=9}

      // Compatibility requirements (optional, but useful)
      requiredChains: [chain],
      requiredCapabilities: ["actions.ready", "wallet.getEthereumProvider"],
    },
  };

  return NextResponse.json(manifest, {
    headers: { "Cache-Control": "public, max-age=300" },
  });
}

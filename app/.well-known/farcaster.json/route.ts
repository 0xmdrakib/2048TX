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
  const appUrlRaw = process.env.NEXT_PUBLIC_APP_URL ?? "https://2048tx.vercel.app/";
  const appUrl = stripTrailingSlash(appUrlRaw);

  // Base mainnet default
  const chain = process.env.NEXT_PUBLIC_REQUIRED_CHAIN ?? "eip155:8453";

  // Prefer env-driven accountAssociation so you can paste into Vercel env vars
  // after generating via Base Build / Warpcast manifest tools.
  const header = process.env.FARCASTER_HEADER ?? "eyJmaWQiOjUzMjc2NCwidHlwZSI6ImF1dGgiLCJrZXkiOiIweEFBM0U0ZDM1MkFmMGYwMUQ4N2YzYTRGNjVENDI4ODJBM2MxNDliYzYifQ";
  const payload = process.env.FARCASTER_PAYLOAD ?? "eyJkb21haW4iOiIyMDQ4dHgudmVyY2VsLmFwcCJ9";
  const signature = process.env.FARCASTER_SIGNATURE ?? "pI/ERRV3QYgJKLhY9zkvPAO33VBDK49GxcUUw6xPK1Zdp/8IYopCfQ+CarGLz96MtXLH4ifkQooHkoHyizXRnhw=";

  const manifest = {
    accountAssociation: { header, payload, signature },
    miniapp: {
      version: "1",
      name: "2048 TX",

      // Identity & launch
      homeUrl: appUrl,
      canonicalDomain: safeHost(appUrl), // optional, but good practice per Farcaster spec

      // Required visuals
      iconUrl: `${appUrl}/icon.png`,
      splashImageUrl: `${appUrl}/splash.png`,
      splashBackgroundColor: "#0000ff",

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
      ogDescription: "Classic 2048 plus optional onchain score plus pay per move.",
      ogImageUrl: `${appUrl}/hero.png`,

      // Keep hidden during testing
      noindex: false, // recommended for staging/dev
      // NOTE: Only include webhookUrl if you actually implement notifications.
      // An invalid URL here can cause clients to refuse adding/pinning the mini app.
      // webhookUrl: `${appUrl}/api/webhook`,
      // Compatibility requirements (optional, but useful)
      requiredChains: [chain],
      requiredCapabilities: ["actions.ready", "wallet.getEthereumProvider"],
    },
  };

  return NextResponse.json(manifest, {
    headers: { "Cache-Control": "public, max-age=300" },
  });
}

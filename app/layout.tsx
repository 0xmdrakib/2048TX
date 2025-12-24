import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "2048 TX",
  description: "2048 with optional pay-per-move and onchain score saves.",
  icons: [{ rel: "icon", url: "/icon.png" }],
};

// ---------------------------------------------------------------------------
// Mini App head tags (Base + Farcaster)
//
// 1) Base Build domain verification expects this on your homepage:
//    <meta name="base:app_id" content="..." />
//
// 2) Base + Farcaster embeds expect your homeUrl to include a serialized embed:
//    <meta name="fc:miniapp" content="<stringified JSON>" />
//    (and optionally fc:frame for backwards compatibility)
// ---------------------------------------------------------------------------

const APP_URL = (process.env.NEXT_PUBLIC_APP_URL || "https://2048tx.vercel.app").replace(/\/$/, "");
const BASE_APP_ID = process.env.NEXT_PUBLIC_BASE_APP_ID || "694b33c3c63ad876c90810df";

const EMBED = {
  version: "next",
  imageUrl: `${APP_URL}/hero.png`,
  button: {
    title: "Open App",
    action: {
      type: "launch_frame",
      name: "2048 TX",
      url: APP_URL,
      splashImageUrl: `${APP_URL}/splash.png`,
      splashBackgroundColor: "#0000FF",
    },
  },
} as const;

const EMBED_CONTENT = JSON.stringify(EMBED);

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <head>
        {/* Base Build domain verification */}
        <meta name="base:app_id" content={BASE_APP_ID} />

        {/* Mini App embeds for discovery/sharing */}
        <meta name="fc:miniapp" content={EMBED_CONTENT} />
        <meta name="fc:frame" content={EMBED_CONTENT} />
      </head>
      <body>{children}</body>
    </html>
  );
}

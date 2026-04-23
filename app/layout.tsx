import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "2048 TX",
  description: "2048 with optional pay-per-move and onchain score saves.",
  icons: [{ rel: "icon", url: "/icon.png" }],
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#faf8f0",
};

// ---------------------------------------------------------------------------
// Mini App head tags (Base + Farcaster)
// ---------------------------------------------------------------------------
const APP_URL = (process.env.NEXT_PUBLIC_APP_URL || "https://2048tx.vercel.app").replace(/\/$/, "");
const BASE_APP_ID = process.env.NEXT_PUBLIC_BASE_APP_ID || "694b33c3c63ad876c90810df";

const MINIAPP_EMBED = {
  version: "1",
  imageUrl: `${APP_URL}/hero.png`,
  button: {
    title: "Play 2048 TX",
    action: {
      type: "launch_miniapp",
      name: "2048 TX",
      url: APP_URL,
      splashImageUrl: `${APP_URL}/splash.png`,
      splashBackgroundColor: "#0000FF",
    },
  },
} as const;

const FRAME_EMBED = {
  version: "next",
  imageUrl: `${APP_URL}/hero.png`,
  button: {
    title: "Play 2048 TX",
    action: {
      type: "launch_frame",
      name: "2048 TX",
      url: APP_URL,
      splashImageUrl: `${APP_URL}/splash.png`,
      splashBackgroundColor: "#0000FF",
    },
  },
} as const;

const MINIAPP_EMBED_CONTENT = JSON.stringify(MINIAPP_EMBED);
const FRAME_EMBED_CONTENT = JSON.stringify(FRAME_EMBED);

// 
const themeInitScript = `
(function() {
  try {
    var t = localStorage.getItem('theme') || 'classic';
    document.documentElement.setAttribute('data-theme', t);
  } catch(e) {
    document.documentElement.setAttribute('data-theme', 'classic');
  }
})();
`;

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" data-theme="classic" suppressHydrationWarning>
      <head>
        {/* Base Build domain verification */}
        <meta name="base:app_id" content={BASE_APP_ID} />
        {/* Mini App embeds for discovery/sharing */}
        <meta name="fc:miniapp" content={MINIAPP_EMBED_CONTENT} />
        <meta name="fc:frame" content={FRAME_EMBED_CONTENT} />
        {/* Anti-flash theme init (runs before React hydration) */}
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
      </head>
      <body>{children}</body>
    </html>
  );
}

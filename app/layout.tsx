import type { Metadata, Viewport } from "next";
import "./globals.css";

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || "https://2048tx.rakibhq.xyz";
const SITE_DESCRIPTION = "2048 with optional pay-per-move and onchain score saves.";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: "2048 TX",
  description: SITE_DESCRIPTION,
  icons: [{ rel: "icon", url: "/icon.png" }],
  openGraph: {
    type: "website",
    url: "/",
    siteName: "2048 TX",
    title: "2048 TX",
    description: SITE_DESCRIPTION,
    images: [
      {
        url: "/og-image.png",
        width: 1200,
        height: 630,
        alt: "2048 TX — The puzzle that moves onchain.",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "2048 TX",
    description: SITE_DESCRIPTION,
    images: [
      {
        url: "/og-image.png",
        alt: "2048 TX — The puzzle that moves onchain.",
      },
    ],
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#faf8f0",
};

const BASE_APP_ID = process.env.NEXT_PUBLIC_BASE_APP_ID || "694b33c3c63ad876c90810df";

// Pre-hydration: apply saved theme before React mounts (kills theme-flash)
const preHydrationScript = `
(function(){
  try {
    var t = localStorage.getItem('theme') || 'classic';
    document.documentElement.setAttribute('data-theme', t);
  } catch(e) {}
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
        <meta name="base:app_id" content={BASE_APP_ID} />
        <script dangerouslySetInnerHTML={{ __html: preHydrationScript }} />
      </head>
      <body>{children}</body>
    </html>
  );
}

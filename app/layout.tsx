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
        <script dangerouslySetInnerHTML={{ __html: preHydrationScript }} />
      </head>
      <body>{children}</body>
    </html>
  );
}

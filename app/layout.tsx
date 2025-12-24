import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "2048 TX",
  description: "2048 with optional pay-per-move and onchain score saves.",
  icons: [{ rel: "icon", url: "/icon.png" }],

  // ✅ Base Build verification tag
  other: {
    "base:app_id": "694b33c3c63ad87c690810df",
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}

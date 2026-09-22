import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "3D Target Challenge",
  description: "A realtime multiplayer 3D target game for 2–8 players.",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased">{children}</body>
    </html>
  );
}

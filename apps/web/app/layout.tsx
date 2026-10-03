import type { Metadata, Viewport } from "next";
import "./globals.css";
export const metadata: Metadata = {
  title: "Recall — your study space",
  description:
    "A focused, local-first space for your Anki decks. Recall, understand, and come back tomorrow.",
  manifest: "/manifest.webmanifest",
  icons: { icon: "/favicon.svg", apple: "/favicon.svg" },
};
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#12695a",
};
export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body suppressHydrationWarning>{children}</body>
    </html>
  );
}

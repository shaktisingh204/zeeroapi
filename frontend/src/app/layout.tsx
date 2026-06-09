import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({ subsets: ["latin"], variable: "--font-sans" });
const geistMono = Geist_Mono({ subsets: ["latin"], variable: "--font-mono" });

export const metadata: Metadata = {
  title: {
    default: "ZeroApi — real-time sports data API",
    template: "%s · ZeroApi",
  },
  description:
    "One API for live scores, matches and odds across multiple bookmakers. REST, typed SDKs, generous free tier.",
  keywords: ["sports data api", "odds api", "live scores", "betting data", "ZeroApi"],
  openGraph: {
    title: "ZeroApi — real-time sports data API",
    description:
      "One API for live scores, matches and odds across multiple bookmakers.",
    type: "website",
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable}`}>
      <body className="font-sans antialiased">{children}</body>
    </html>
  );
}

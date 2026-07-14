import type { Metadata } from "next";
import { Newsreader, IBM_Plex_Mono } from "next/font/google";
import { Analytics } from "@vercel/analytics/next";
import "./globals.css";

const newsreader = Newsreader({
  variable: "--font-newsreader",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  style: ["normal", "italic"],
});

const plexMono = IBM_Plex_Mono({
  variable: "--font-plex-mono",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
});

export const metadata: Metadata = {
  metadataBase: new URL("https://coach.tamasdemeter.com"),
  title: "n8n Workflow Coach — grounded in the n8n docs",
  description:
    "Ask questions about n8n. Paste a broken workflow. Get grounded answers with citations from the official n8n documentation.",
  openGraph: {
    title: "n8n Workflow Coach",
    description: "Ask n8n questions. Paste a workflow to debug. Answers cite the official docs.",
    url: "https://coach.tamasdemeter.com",
    siteName: "n8n Workflow Coach",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "n8n Workflow Coach",
    description: "Ask n8n questions. Paste a workflow to debug. Answers cite the official docs.",
  },
  robots: { index: true, follow: true },
  authors: [{ name: "Tamas Demeter", url: "https://tamasdemeter.com" }],
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${newsreader.variable} ${plexMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        {children}
        <Analytics />
      </body>
    </html>
  );
}

import { APP_DESCRIPTION, APP_NAME } from "@drop-watch/brand";
import { env } from "@drop-watch/env/server";
import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";

import "../index.css";
import Providers from "@/components/providers";

const geistSans = Geist({
  subsets: ["latin"],
  variable: "--font-geist-sans",
});

const geistMono = Geist_Mono({
  subsets: ["latin"],
  variable: "--font-geist-mono",
});

export const metadata: Metadata = {
  appleWebApp: { capable: true, statusBarStyle: "default", title: APP_NAME },
  applicationName: APP_NAME,
  description: APP_DESCRIPTION,
  // Optional because the build runs with SKIP_ENV_VALIDATION and no URL at
  // all: `new URL(undefined)` there throws while Next collects page data.
  // Read at module load, so the standalone server picks up the self-hoster's
  // real address on boot; only prerendered HTML keeps a build-time value.
  metadataBase: env.BETTER_AUTH_URL ? new URL(env.BETTER_AUTH_URL) : undefined,
  openGraph: {
    description: APP_DESCRIPTION,
    siteName: APP_NAME,
    title: APP_NAME,
    type: "website",
  },
  title: { default: APP_NAME, template: `%s · ${APP_NAME}` },
  twitter: { card: "summary_large_image", description: APP_DESCRIPTION, title: APP_NAME },
};

/**
 * Two colours rather than one: the shell follows the system scheme through
 * next-themes, so a single theme-color would leave the browser chrome fighting
 * whichever mode the user is actually in.
 */
export const viewport: Viewport = {
  themeColor: [
    { color: "#ffffff", media: "(prefers-color-scheme: light)" },
    { color: "#0a0a0a", media: "(prefers-color-scheme: dark)" },
  ],
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className={`${geistSans.variable} ${geistMono.variable} antialiased`}>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}

import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { headers } from "next/headers";
import { AppShell } from "./components/AppShell";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export async function generateMetadata(): Promise<Metadata> {
  const requestHeaders = await headers();
  const forwardedHost = requestHeaders.get("x-forwarded-host");
  const host = forwardedHost ?? requestHeaders.get("host") ?? "localhost:3000";
  const protocol =
    requestHeaders.get("x-forwarded-proto") ??
    (host.startsWith("localhost") || host.startsWith("127.0.0.1")
      ? "http"
      : "https");
  const origin = `${protocol}://${host}`;
  const title = "Social Listening — VinSmart Future";
  const description =
    "Theo dõi bình luận, phản hồi và sắc thái thảo luận về VinSmart Future trên mạng xã hội.";
  const socialImage = `${origin}/og.png`;

  return {
    metadataBase: new URL(origin),
    title: {
      default: title,
      template: "%s · Social Listening",
    },
    description,
    applicationName: "Social Listening",
    keywords: ["VinSmart Future", "social listening", "Facebook", "sentiment"],
    icons: {
      icon: "/vinsmart-future-symbol.png",
      apple: "/vinsmart-future-symbol.png",
    },
    openGraph: {
      type: "website",
      locale: "vi_VN",
      siteName: "Social Listening",
      title,
      description,
      images: [{ url: socialImage, width: 1734, height: 907, alt: title }],
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: [socialImage],
    },
  };
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="vi">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}

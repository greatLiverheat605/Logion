import type { Metadata, Viewport } from "next";
import { headers } from "next/headers";
import type { ReactNode } from "react";

import { ServiceWorkerRegistration } from "@/components/service-worker-registration";

import "./globals.css";

export const metadata: Metadata = {
  title: "Logion",
  description: "让学习、研究与长期成长形成可验证的闭环。",
  manifest: "/manifest.webmanifest",
};

export const viewport: Viewport = {
  colorScheme: "dark",
  themeColor: "#07111f",
};

export default async function RootLayout({
  children,
}: Readonly<{ children: ReactNode }>) {
  // Dynamic HTML lets Next attach the per-request CSP nonce to hydration scripts.
  await headers();
  return (
    <html lang="zh-CN">
      <body>
        <a className="skip-link" href="#main-content">
          跳到主要内容
        </a>
        {children}
        <ServiceWorkerRegistration />
      </body>
    </html>
  );
}

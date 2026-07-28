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
  colorScheme: "light dark",
  themeColor: [
    { color: "#f4f5f7", media: "(prefers-color-scheme: light)" },
    { color: "#1c1c1e", media: "(prefers-color-scheme: dark)" },
  ],
};

const themeBootstrap = `(()=>{try{const k="app-shell-theme";const s=localStorage.getItem(k);const t=s==="light"||s==="dark"?s:matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light";document.documentElement.dataset.theme=t}catch{document.documentElement.dataset.theme="light"}})()`;

export default async function RootLayout({
  children,
}: Readonly<{ children: ReactNode }>) {
  // Dynamic HTML lets Next attach the per-request CSP nonce to hydration scripts.
  const requestHeaders = await headers();
  const nonce = requestHeaders.get("x-nonce") ?? undefined;
  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <head>
        <script
          dangerouslySetInnerHTML={{ __html: themeBootstrap }}
          nonce={nonce}
          suppressHydrationWarning
        />
      </head>
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

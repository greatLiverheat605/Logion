type UserAgentBrand = Readonly<{ brand: string; version: string }>;

type BrowserIdentity = Readonly<{
  platform?: string;
  userAgent: string;
  userAgentData?: Readonly<{
    brands?: readonly UserAgentBrand[];
    platform?: string;
  }>;
}>;

function detectPlatform(identity: BrowserIdentity): string | null {
  const source = [
    identity.userAgentData?.platform,
    identity.platform,
    identity.userAgent,
  ]
    .filter(Boolean)
    .join(" ");

  if (/iPhone/i.test(source)) return "iPhone";
  if (/iPad/i.test(source)) return "iPad";
  if (/Android/i.test(source)) return "Android";
  if (/CrOS/i.test(source)) return "ChromeOS";
  if (/Windows/i.test(source)) return "Windows";
  if (/Macintosh|Mac OS|macOS/i.test(source)) return "macOS";
  if (/Linux/i.test(source)) return "Linux";
  return null;
}

function detectBrowser(identity: BrowserIdentity): string | null {
  const brands = identity.userAgentData?.brands ?? [];
  const brandNames = brands.map(({ brand }) => brand.toLowerCase());
  if (brandNames.some((brand) => brand.includes("microsoft edge"))) {
    return "Edge";
  }
  if (brandNames.some((brand) => brand.includes("opera"))) return "Opera";
  if (brandNames.some((brand) => brand.includes("google chrome"))) {
    return "Chrome";
  }
  if (brandNames.some((brand) => brand === "chromium")) return "Chromium";

  const userAgent = identity.userAgent;
  if (/EdgA?\//i.test(userAgent) || /EdgiOS\//i.test(userAgent)) return "Edge";
  if (/OPR\//i.test(userAgent)) return "Opera";
  if (/Firefox\//i.test(userAgent) || /FxiOS\//i.test(userAgent)) {
    return "Firefox";
  }
  if (/Chrome\//i.test(userAgent) || /CriOS\//i.test(userAgent)) {
    return "Chrome";
  }
  if (/Safari\//i.test(userAgent) && /Version\//i.test(userAgent)) {
    return "Safari";
  }
  return null;
}

export function detectDeviceName(identity: BrowserIdentity): string {
  const platform = detectPlatform(identity);
  const browser = detectBrowser(identity);
  if (platform !== null && browser !== null) return `${platform} · ${browser}`;
  return platform ?? browser ?? "此浏览器";
}

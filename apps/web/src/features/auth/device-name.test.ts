import { describe, expect, it } from "vitest";

import { detectDeviceName } from "./device-name";

describe("detectDeviceName", () => {
  it("uses client hints for Windows and Edge", () => {
    expect(
      detectDeviceName({
        userAgent: "Mozilla/5.0",
        userAgentData: {
          brands: [{ brand: "Microsoft Edge", version: "140" }],
          platform: "Windows",
        },
      }),
    ).toBe("Windows · Edge");
  });

  it("detects macOS Safari from its user agent", () => {
    expect(
      detectDeviceName({
        userAgent:
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/18.6 Safari/605.1.15",
      }),
    ).toBe("macOS · Safari");
  });

  it("keeps iPhone distinct from macOS", () => {
    expect(
      detectDeviceName({
        userAgent:
          "Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 Version/18.6 Mobile/15E148 Safari/604.1",
      }),
    ).toBe("iPhone · Safari");
  });

  it("detects Android Chrome", () => {
    expect(
      detectDeviceName({
        userAgent:
          "Mozilla/5.0 (Linux; Android 16) AppleWebKit/537.36 Chrome/140.0.0.0 Mobile Safari/537.36",
      }),
    ).toBe("Android · Chrome");
  });

  it("falls back without exposing additional device data", () => {
    expect(detectDeviceName({ userAgent: "unknown" })).toBe("此浏览器");
  });
});

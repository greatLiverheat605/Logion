import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

function mobileFile(relativePath) {
  return new URL(`../${relativePath}`, import.meta.url);
}

async function text(relativePath) {
  return readFile(mobileFile(relativePath), "utf8");
}

test("Android uses the approved TWA identity and HTTPS origin", async () => {
  const [manifest, strings, gradle] = await Promise.all([
    text("android/app/src/main/AndroidManifest.xml"),
    text("android/app/src/main/res/values/strings.xml"),
    text("android/app/build.gradle"),
  ]);

  assert.match(gradle, /applicationId "work\.logion\.app"/);
  assert.match(
    gradle,
    /com\.google\.androidbrowserhelper:androidbrowserhelper:2\.7\.2/,
  );
  assert.match(
    manifest,
    /com\.google\.androidbrowserhelper\.trusted\.LauncherActivity/,
  );
  assert.match(strings, /https:\/\/logion\.work\/app\/today/);
  assert.doesNotMatch(manifest, /android\.webkit\.WebView|JavascriptInterface/);
});

test("Android shell disables backup and cleartext transport", async () => {
  const [manifest, networkPolicy] = await Promise.all([
    text("android/app/src/main/AndroidManifest.xml"),
    text("android/app/src/main/res/xml/network_security_config.xml"),
  ]);

  assert.match(manifest, /android:allowBackup="false"/);
  assert.match(manifest, /android:fullBackupContent="false"/);
  assert.match(manifest, /android:usesCleartextTraffic="false"/);
  assert.match(networkPolicy, /cleartextTrafficPermitted="false"/);
  assert.doesNotMatch(networkPolicy, /certificates src="user"/);
});

test("mobile package has no web bridge dependency or embedded secret", async () => {
  const [packageText, manifest, strings, iosBrowser] = await Promise.all([
    text("package.json"),
    text("android/app/src/main/AndroidManifest.xml"),
    text("android/app/src/main/res/values/strings.xml"),
    text("ios/Sources/BrowserScreen.swift"),
  ]);
  const combined = `${packageText}\n${manifest}\n${strings}\n${iosBrowser}`;

  assert.doesNotMatch(
    combined,
    /@capacitor|JavascriptInterface|WKScriptMessageHandler|evaluateJavaScript/,
  );
  assert.doesNotMatch(
    combined,
    /(?:password|apiKey|recoveryKey|cookie)\s*[:=]\s*["'][^"']+["']/i,
  );
});

test("iOS limits its persistent WebKit session to the approved domain", async () => {
  const [browser, plist, project] = await Promise.all([
    text("ios/Sources/BrowserScreen.swift"),
    text("ios/Config/Info.plist"),
    text("ios/project.yml"),
  ]);

  assert.match(browser, /https:\/\/logion\.work\/app\/today/);
  assert.match(browser, /limitsNavigationsToAppBoundDomains = true/);
  assert.match(browser, /websiteDataStore = \.default\(\)/);
  assert.match(browser, /webView\.isInspectable = false/);
  assert.match(plist, /<string>logion\.work<\/string>/);
  assert.match(plist, /<key>NSAllowsArbitraryLoads<\/key>\s*<false\/>/);
  assert.match(project, /PRODUCT_BUNDLE_IDENTIFIER: work\.logion\.app/);
  assert.doesNotMatch(project, /DEVELOPMENT_TEAM/);
});

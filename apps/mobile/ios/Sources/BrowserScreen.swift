import SwiftUI
import WebKit

@MainActor
final class BrowserSession: ObservableObject {
    enum State: Equatable {
        case loading
        case ready
        case failed
    }

    @Published var state: State = .loading
    @Published var reloadID = UUID()

    func retry() {
        state = .loading
        reloadID = UUID()
    }
}

struct BrowserScreen: View {
    @ObservedObject var browser: BrowserSession

    var body: some View {
        ZStack {
            SecureWebView(browser: browser)

            if browser.state == .failed {
                ConnectionFailureView(retry: browser.retry)
            }
        }
        .background(Color(red: 7 / 255, green: 17 / 255, blue: 31 / 255))
    }
}

private struct ConnectionFailureView: View {
    let retry: () -> Void

    var body: some View {
        VStack(spacing: 16) {
            Text("L")
                .font(.system(size: 28, weight: .bold, design: .rounded))
                .foregroundStyle(.white)
                .frame(width: 58, height: 58)
                .background(Color(red: 47 / 255, green: 111 / 255, blue: 237 / 255))
                .clipShape(RoundedRectangle(cornerRadius: 18, style: .continuous))

            Text("暂时无法连接 Logion")
                .font(.title2.weight(.semibold))

            Text("请检查网络后重试。这个操作不会清除设备上的学习数据。")
                .font(.body)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)

            Button("重新连接", action: retry)
                .buttonStyle(.borderedProminent)
        }
        .padding(28)
        .frame(maxWidth: 380)
        .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 28))
        .padding(24)
    }
}

private struct SecureWebView: UIViewRepresentable {
    private static let startURL = URL(string: "https://logion.work/app/today")!
    private static let allowedHost = "logion.work"

    @ObservedObject var browser: BrowserSession

    func makeCoordinator() -> Coordinator {
        Coordinator(browser: browser)
    }

    func makeUIView(context: Context) -> WKWebView {
        let configuration = WKWebViewConfiguration()
        configuration.websiteDataStore = .default()
        configuration.limitsNavigationsToAppBoundDomains = true
        configuration.preferences.javaScriptCanOpenWindowsAutomatically = false
        configuration.defaultWebpagePreferences.allowsContentJavaScript = true

        let webView = WKWebView(frame: .zero, configuration: configuration)
        webView.navigationDelegate = context.coordinator
        webView.uiDelegate = context.coordinator
        webView.allowsBackForwardNavigationGestures = true
        webView.allowsLinkPreview = true
        if #available(iOS 16.4, *) {
            webView.isInspectable = false
        }
        context.coordinator.lastReloadID = browser.reloadID
        webView.load(URLRequest(url: Self.startURL))
        return webView
    }

    func updateUIView(_ webView: WKWebView, context: Context) {
        guard context.coordinator.lastReloadID != browser.reloadID else { return }
        context.coordinator.lastReloadID = browser.reloadID
        webView.load(URLRequest(url: Self.startURL))
    }

    @MainActor
    final class Coordinator: NSObject, WKNavigationDelegate, WKUIDelegate {
        private let browser: BrowserSession
        var lastReloadID: UUID?

        init(browser: BrowserSession) {
            self.browser = browser
        }

        func webView(_ webView: WKWebView, didStartProvisionalNavigation navigation: WKNavigation?) {
            browser.state = .loading
        }

        func webView(_ webView: WKWebView, didFinish navigation: WKNavigation?) {
            browser.state = .ready
        }

        func webView(
            _ webView: WKWebView,
            didFailProvisionalNavigation navigation: WKNavigation?,
            withError error: Error
        ) {
            browser.state = .failed
        }

        func webView(_ webView: WKWebView, didFail navigation: WKNavigation?, withError error: Error) {
            browser.state = .failed
        }

        func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
            browser.state = .loading
            webView.reload()
        }

        func webView(
            _ webView: WKWebView,
            decidePolicyFor navigationAction: WKNavigationAction,
            decisionHandler: @escaping (WKNavigationActionPolicy) -> Void
        ) {
            guard let url = navigationAction.request.url else {
                decisionHandler(.cancel)
                return
            }

            if Self.isAllowed(url) {
                decisionHandler(.allow)
                return
            }

            if ["https", "mailto"].contains(url.scheme?.lowercased() ?? "") {
                UIApplication.shared.open(url)
            }
            decisionHandler(.cancel)
        }

        func webView(
            _ webView: WKWebView,
            createWebViewWith configuration: WKWebViewConfiguration,
            for navigationAction: WKNavigationAction,
            windowFeatures: WKWindowFeatures
        ) -> WKWebView? {
            guard navigationAction.targetFrame == nil,
                  let url = navigationAction.request.url else {
                return nil
            }

            if Self.isAllowed(url) {
                webView.load(URLRequest(url: url))
            } else if ["https", "mailto"].contains(url.scheme?.lowercased() ?? "") {
                UIApplication.shared.open(url)
            }
            return nil
        }

        private static func isAllowed(_ url: URL) -> Bool {
            url.scheme?.lowercased() == "https" &&
                url.host?.lowercased() == SecureWebView.allowedHost &&
                url.user == nil &&
                url.password == nil
        }
    }
}

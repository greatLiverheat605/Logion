import SwiftUI

@main
struct LogionApp: App {
    @StateObject private var browser = BrowserSession()

    var body: some Scene {
        WindowGroup {
            BrowserScreen(browser: browser)
        }
    }
}

import SwiftUI
import WebKit

// Studio: the whole of roartransfer.com/studio inside the app, already signed in with the app's account (the
// session goes into the page's own storage, key roarme-auth-2, as the website keeps it, and a newer one the page
// makes comes back to the app). What it downloads goes to Files > On My iPhone > RoarTransfer.
struct StudioView: View {
    @EnvironmentObject var session: Session
    @EnvironmentObject var lang: Lang
    @State private var ready: String?   // the session as the page keeps it, or "" when signed out
    @State private var loading = true

    var body: some View {
        ZStack {
            if let r = ready {
                StudioWeb(sessionJSON: r, lang: lang.code, loading: $loading)
                    .clipShape(RoundedRectangle(cornerRadius: 26, style: .continuous))
                    .overlay(RoundedRectangle(cornerRadius: 26, style: .continuous).stroke(Color.white.opacity(0.14)))
                    .padding(.horizontal, 10).padding(.top, 4)
            }
            if loading { ProgressView().tint(Theme.text).scaleEffect(1.2) }
        }
        .task(id: session.signedIn) { ready = nil; loading = true; ready = await sessionJSON() }
    }

    private func sessionJSON() async -> String {
        guard let token = await session.freshToken(), let s = session.stored else { return "" }
        var user: Any = [String: Any]()
        if let (d, _) = try? await URLSession.shared.data(for: API.request(Config.base.appendingPathComponent("auth/v1/user"), auth: token)),
           let j = try? JSONSerialization.jsonObject(with: d) { user = j }
        let obj: [String: Any] = ["access_token": s.access, "refresh_token": s.refresh, "token_type": "bearer",
                                  "expires_at": Int(s.expires), "expires_in": max(60, Int(s.expires - Date().timeIntervalSince1970)), "user": user]
        let d = (try? JSONSerialization.data(withJSONObject: obj)) ?? Data()
        return String(data: d, encoding: .utf8) ?? ""
    }
}

struct StudioWeb: UIViewRepresentable {
    var sessionJSON: String
    var lang: String
    @Binding var loading: Bool

    func makeCoordinator() -> Coord { Coord(self) }

    func makeUIView(context: Context) -> WKWebView {
        let c = WKWebViewConfiguration()
        c.websiteDataStore = .default()
        c.allowsInlineMediaPlayback = true
        let ucc = WKUserContentController()
        let quoted = String(data: (try? JSONSerialization.data(withJSONObject: [sessionJSON, lang])) ?? Data(), encoding: .utf8) ?? "[\"\",\"en\"]"
        // before the page's own code: our session in, the language, and every new session the page saves sent back
        let js = """
        (function(){var a=\(quoted),K='roarme-auth-2';
        try{ if(a[0]){ var cur=localStorage.getItem(K); var o=cur?JSON.parse(cur):null; var n=JSON.parse(a[0]);
          if(!o||!o.expires_at||o.expires_at<n.expires_at||o.refresh_token!==n.refresh_token&&!o.user){ localStorage.setItem(K,a[0]); } }
          localStorage.setItem('rs-lang',a[1]); localStorage.setItem('roartransfer.lang',a[1]); }catch(e){}
        var set=Storage.prototype.setItem; Storage.prototype.setItem=function(k,v){ set.apply(this,arguments);
          if(k===K){ try{ window.webkit.messageHandlers.session.postMessage(String(v)); }catch(e){} } };
        document.documentElement.classList.add('in-app');})();
        """
        ucc.addUserScript(WKUserScript(source: js, injectionTime: .atDocumentStart, forMainFrameOnly: true))
        ucc.add(context.coordinator, name: "session")
        c.userContentController = ucc
        let w = WKWebView(frame: .zero, configuration: c)
        w.navigationDelegate = context.coordinator
        w.uiDelegate = context.coordinator
        w.isOpaque = false
        w.backgroundColor = .clear
        w.scrollView.backgroundColor = .clear
        w.allowsBackForwardNavigationGestures = true
        // pull down: the page loads again
        let rc = UIRefreshControl()
        rc.tintColor = .white
        rc.addTarget(context.coordinator, action: #selector(Coord.pulled(_:)), for: .valueChanged)
        w.scrollView.refreshControl = rc
        context.coordinator.web = w
        w.load(URLRequest(url: URL(string: "https://roartransfer.com/studio/")!))
        return w
    }
    func updateUIView(_ w: WKWebView, context: Context) {}

    final class Coord: NSObject, WKNavigationDelegate, WKUIDelegate, WKScriptMessageHandler, WKDownloadDelegate {
        let parent: StudioWeb
        weak var web: WKWebView?
        init(_ p: StudioWeb) { parent = p }
        @objc func pulled(_ rc: UIRefreshControl) {
            UIImpactFeedbackGenerator(style: .soft).impactOccurred()
            web?.reload()
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.8) { rc.endRefreshing() }
        }

        func userContentController(_ u: WKUserContentController, didReceive m: WKScriptMessage) {
            guard m.name == "session", let s = m.body as? String, let d = s.data(using: .utf8),
                  let j = try? JSONSerialization.jsonObject(with: d) as? [String: Any],
                  let a = j["access_token"] as? String, let r = j["refresh_token"] as? String else { return }
            let exp = (j["expires_at"] as? Double) ?? Double((j["expires_at"] as? Int) ?? 0)
            Task { @MainActor in Session.shared.adopt(access: a, refresh: r, expiresAt: exp) }
        }

        func webView(_ w: WKWebView, didFinish n: WKNavigation!) { DispatchQueue.main.async { self.parent.loading = false } }
        func webView(_ w: WKWebView, didFail n: WKNavigation!, withError e: Error) { DispatchQueue.main.async { self.parent.loading = false } }
        func webView(_ w: WKWebView, didFailProvisionalNavigation n: WKNavigation!, withError e: Error) { DispatchQueue.main.async { self.parent.loading = false } }

        // roartransfer.com stays inside; anything else opens in Safari
        func webView(_ w: WKWebView, decidePolicyFor a: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
            if a.shouldPerformDownload { decisionHandler(.download); return }
            if let u = a.request.url, let h = u.host, !h.hasSuffix("roartransfer.com"), !h.hasSuffix("supabase.co"), a.navigationType == .linkActivated {
                UIApplication.shared.open(u); decisionHandler(.cancel); return
            }
            decisionHandler(.allow)
        }
        func webView(_ w: WKWebView, decidePolicyFor r: WKNavigationResponse, decisionHandler: @escaping (WKNavigationResponsePolicy) -> Void) {
            let disp = (r.response as? HTTPURLResponse)?.value(forHTTPHeaderField: "Content-Disposition") ?? ""
            decisionHandler(!r.canShowMIMEType || disp.lowercased().hasPrefix("attachment") ? .download : .allow)
        }
        func webView(_ w: WKWebView, navigationAction: WKNavigationAction, didBecome d: WKDownload) { d.delegate = self }
        func webView(_ w: WKWebView, navigationResponse: WKNavigationResponse, didBecome d: WKDownload) { d.delegate = self }
        func download(_ d: WKDownload, decideDestinationUsing r: URLResponse, suggestedFilename name: String, completionHandler: @escaping (URL?) -> Void) {
            var dest = Downloads.folder.appendingPathComponent(name.isEmpty ? "file" : name)
            var n = 2
            let base = (name as NSString).deletingPathExtension, ext = (name as NSString).pathExtension
            while FileManager.default.fileExists(atPath: dest.path) { dest = Downloads.folder.appendingPathComponent(ext.isEmpty ? "\(base) (\(n))" : "\(base) (\(n)).\(ext)"); n += 1 }
            completionHandler(dest)
        }
        func downloadDidFinish(_ d: WKDownload) { DispatchQueue.main.async { Glass.tap(.medium) } }

        // links that open a new window open here
        func webView(_ w: WKWebView, createWebViewWith c: WKWebViewConfiguration, for a: WKNavigationAction, windowFeatures f: WKWindowFeatures) -> WKWebView? {
            if let u = a.request.url {
                if let h = u.host, h.hasSuffix("roartransfer.com") { w.load(URLRequest(url: u)) } else { UIApplication.shared.open(u) }
            }
            return nil
        }
    }
}

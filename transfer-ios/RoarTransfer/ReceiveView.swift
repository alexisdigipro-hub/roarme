import SwiftUI
import UIKit

// Receive: a link opened from WhatsApp, Mail or anywhere lands here (or is pasted). Videos and photos go straight
// into Photos, any size; everything else into Files (On My iPhone > RoarTransfer).
struct ReceiveView: View {
    @EnvironmentObject var router: Router
    @EnvironmentObject var downloads: Downloads
    @State private var pasted = ""
    @State private var token: String?
    @State private var info: LinkInfo?
    @State private var loading = false
    @State private var password = ""
    @State private var pwError = ""
    @State private var problem = ""

    var body: some View {
        NavigationStack {
            ZStack {
                Backdrop()
                ScrollView {
                    VStack(spacing: 16) {
                        HStack { Wordmark(); Spacer() }.padding(.top, 8)
                        if token == nil { start } else { linkPage }
                    }
                    .padding(.horizontal, 16)
                    .padding(.bottom, 30)
                }
                .scrollDismissesKeyboard(.interactively)
            }
            .toolbar(.hidden, for: .navigationBar)
        }
        .onChange(of: router.openToken) { t in if let t { openLink(t); router.openToken = nil } }
        .onAppear { if let t = router.openToken { openLink(t); router.openToken = nil } }
    }

    // ---- no link yet ----
    private var start: some View {
        VStack(spacing: 16) {
            PageTitle(text: "Open a link")
            Tile {
                VStack(alignment: .leading, spacing: 12) {
                    Text("Tap a RoarTransfer link anywhere and it opens here. Or paste it:")
                        .font(.system(size: 15)).foregroundStyle(Theme.muted)
                    GlassField(placeholder: "roartransfer.com/…", text: $pasted, keyboard: .URL)
                        .submitLabel(.go)
                        .onSubmit { tryOpen(pasted) }
                    HStack(spacing: 10) {
                        Button { if let s = UIPasteboard.general.string { pasted = s; tryOpen(s) } } label: {
                            Label("Paste", systemImage: "doc.on.clipboard")
                        }.buttonStyle(PillStyle())
                        Button { tryOpen(pasted) } label: { Label("Open", systemImage: "arrow.right") }
                            .buttonStyle(PillStyle(main: true))
                            .disabled(API.token(from: pasted) == nil)
                            .opacity(API.token(from: pasted) == nil ? 0.5 : 1)
                    }
                    if !problem.isEmpty { Text(problem).font(.system(size: 14)).foregroundStyle(Theme.redHi) }
                }
            }
            Tile {
                VStack(alignment: .leading, spacing: 10) {
                    feature("photo.on.rectangle.angled", "Straight to Photos", "Videos and photos go into your Photos in their full size, however big.")
                    feature("lock.iphone", "Keeps going", "Downloads carry on with the screen locked or the app closed.")
                    feature("folder", "Everything else in Files", "Find them in Files > On My iPhone > RoarTransfer.")
                }
            }
            if !downloads.items.isEmpty { recent }
        }
    }

    private func feature(_ icon: String, _ title: String, _ line: String) -> some View {
        HStack(alignment: .top, spacing: 12) {
            Image(systemName: icon).font(.system(size: 18)).foregroundStyle(Theme.redHi).frame(width: 26)
            VStack(alignment: .leading, spacing: 2) {
                Text(title).font(.system(size: 15, weight: .semibold)).foregroundStyle(Theme.text)
                Text(line).font(.system(size: 13)).foregroundStyle(Theme.muted)
            }
        }
    }

    private var recent: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("DOWNLOADS").font(.system(size: 12, weight: .semibold)).kerning(1.5).foregroundStyle(Theme.dim).padding(.leading, 6)
            ForEach(Array(downloads.items.values).sorted(by: { $0.name < $1.name })) { it in
                DownloadRow(name: it.name, size: it.size, type: nil, item: it, onSave: nil)
            }
        }
    }

    // ---- a link ----
    @ViewBuilder private var linkPage: some View {
        HStack {
            Button { close() } label: { Image(systemName: "chevron.left") }.buttonStyle(RoundStyle())
            Spacer()
        }
        if loading && info == nil {
            ProgressView().tint(Theme.text).padding(40)
        } else if let info {
            if info.error == "password" { passwordTile(info) }
            else if let e = info.error { gone(e, info) }
            else { files(info) }
        }
    }

    private func passwordTile(_ i: LinkInfo) -> some View {
        Tile {
            VStack(alignment: .leading, spacing: 12) {
                if let f = i.from, !f.isEmpty { Text("\(f) sent you").font(.system(size: 15)).foregroundStyle(Theme.muted) }
                Text("This transfer has a password").font(.system(size: 22, weight: .bold)).foregroundStyle(Theme.text)
                GlassField(placeholder: "Password", text: $password, secure: true).submitLabel(.go).onSubmit { unlock() }
                if !pwError.isEmpty { Text(pwError).font(.system(size: 14)).foregroundStyle(Theme.redHi) }
                Button { unlock() } label: { Text("Open").frame(maxWidth: .infinity) }.buttonStyle(PillStyle(main: true)).disabled(password.isEmpty || loading)
            }
        }
    }

    private func gone(_ e: String, _ i: LinkInfo) -> some View {
        Tile {
            VStack(spacing: 12) {
                Image(systemName: e == "payment" ? "lock.fill" : "xmark").font(.system(size: 28)).foregroundStyle(Theme.muted)
                    .frame(width: 70, height: 70).background(Circle().fill(Theme.glass)).overlay(Circle().stroke(Theme.edge))
                Text(e == "expired" ? "This transfer has ended" : e == "payment" ? "Locked until paid" : e == "not_found" ? "This link does not work" : "Something went wrong")
                    .font(.system(size: 22, weight: .bold)).foregroundStyle(Theme.text).multilineTextAlignment(.center)
                Text(e == "expired" ? "Its files are no longer here. Ask the sender for a new link." : e == "payment" ? "The sender will unlock these files once they are paid for." : e == "not_found" ? "Check that the whole link was copied." : e)
                    .font(.system(size: 15)).foregroundStyle(Theme.muted).multilineTextAlignment(.center)
                if e == "payment", !i.allFiles.isEmpty {
                    VStack(spacing: 6) { ForEach(i.allFiles) { f in Text(f.displayName).font(.system(size: 14)).foregroundStyle(Theme.dim) } }
                }
            }.frame(maxWidth: .infinity)
        }
    }

    private func files(_ i: LinkInfo) -> some View {
        let all = i.allFiles.filter { !($0.used ?? false) && $0.url != nil && !($0.url ?? "").isEmpty }
        let total = i.allFiles.reduce(Int64(0)) { $0 + $1.bytes }
        return VStack(spacing: 14) {
            Tile {
                VStack(alignment: .leading, spacing: 6) {
                    if let f = i.from, !f.isEmpty { Text("\(f) sent you").font(.system(size: 15)).foregroundStyle(Theme.muted) }
                    Text((i.title ?? "").isEmpty ? (i.allFiles.count == 1 ? i.allFiles[0].displayName : "\(i.allFiles.count) files") : i.title!)
                        .font(.system(size: 24, weight: .bold)).foregroundStyle(Theme.text)
                    Text([sizeText(total), i.expires.map { "until " + Dates.short($0) } ?? ""].filter { !$0.isEmpty }.joined(separator: " · "))
                        .font(.system(size: 13, design: .monospaced)).foregroundStyle(Theme.dim)
                    if let m = i.message, !m.isEmpty { Text(m).font(.system(size: 15)).foregroundStyle(Theme.text).padding(.top, 6) }
                }
            }
            if !all.isEmpty {
                Button { all.forEach { save($0) } } label: {
                    Label(all.allSatisfy { $0.isMedia } ? "Save All to Photos" : all.contains { $0.isMedia } ? "Save All" : "Download All", systemImage: "arrow.down")
                        .frame(maxWidth: .infinity)
                }.buttonStyle(PillStyle(main: true))
                if all.contains(where: { $0.isMedia }) && !all.allSatisfy({ $0.isMedia }) {
                    Text("Videos and photos go to Photos, the rest to Files.").font(.system(size: 13)).foregroundStyle(Theme.dim)
                }
            }
            VStack(spacing: 8) {
                ForEach(i.allFiles) { f in
                    DownloadRow(name: f.displayName, size: f.bytes, type: f.type, item: downloads.items[f.id], used: (f.used ?? false) || (f.url ?? "").isEmpty, onSave: { toFiles in save(f, toFiles: toFiles) }, media: f.isMedia)
                }
            }
        }
    }

    // ---- actions ----
    private func tryOpen(_ s: String) {
        problem = ""
        guard let t = API.token(from: s) else { problem = "This does not look like a RoarTransfer link."; return }
        openLink(t)
    }
    private func openLink(_ t: String) {
        token = t; info = nil; password = ""; pwError = ""; problem = ""
        load()
    }
    private func load() {
        guard let t = token else { return }
        loading = true
        Task {
            do {
                let i = try await API.link(t, password: password)
                if i.error == "password" && !password.isEmpty { pwError = i.slow == true ? "Too many wrong tries. Wait 15 minutes and try again." : "Wrong password, try again." }
                else { pwError = "" }
                if i.error == "password", let old = info, old.error == "password" { info = old } else { info = i }
                if i.error == nil { API.hit(t) }
            } catch {
                info = LinkInfo(error: "Could not reach RoarTransfer. Check the connection and try again.")
            }
            loading = false
        }
    }
    private func unlock() { load() }
    private func close() { token = nil; info = nil; pasted = "" }
    private func save(_ f: LinkFile, toFiles: Bool = false) {
        downloads.start(f, toPhotos: f.isMedia && !toFiles)
    }
}

// one file: its kind, name, size and where it stands; Save to Photos / Save to Files, then Show / Share
struct DownloadRow: View {
    var name: String
    var size: Int64
    var type: String?
    var item: Downloads.Item?
    var used = false
    var onSave: ((Bool) -> Void)?
    var media = false
    @State private var share: URL?

    var body: some View {
        Tile(pad: 12) {
            VStack(alignment: .leading, spacing: 10) {
                HStack(spacing: 12) {
                    Image(systemName: kindIcon(name, type: type)).font(.system(size: 18)).foregroundStyle(Theme.redHi)
                        .frame(width: 44, height: 44).background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(Color.white.opacity(0.06)))
                    VStack(alignment: .leading, spacing: 3) {
                        Text(name).font(.system(size: 15, weight: .medium)).foregroundStyle(Theme.text).lineLimit(2)
                        Text(line).font(.system(size: 12, design: .monospaced)).foregroundStyle(stateColor)
                    }
                    Spacer(minLength: 6)
                    trailing
                }
                if case .loading(let p) = item?.state { ProgressBar(value: p) }
            }
        }
        .sheet(item: $share) { u in ShareSheet(items: [u]).presentationDetents([.medium, .large]) }
    }

    private var line: String {
        switch item?.state {
        case .loading(let p): return "\(Int(p * 100))% of \(sizeText(size))"
        case .saving: return "Saving to Photos…"
        case .inPhotos: return "Saved to Photos"
        case .inFiles: return "Saved in Files"
        case .failed(let m): return m
        default: return used ? "Already downloaded" : sizeText(size)
        }
    }
    private var stateColor: Color {
        switch item?.state {
        case .inPhotos, .inFiles: return Theme.ok
        case .failed: return Theme.redHi
        default: return Theme.dim
        }
    }

    @ViewBuilder private var trailing: some View {
        switch item?.state {
        case .loading, .saving, .waiting:
            Button { if let id = item?.id { Downloads.shared.cancel(id) } } label: { Image(systemName: "xmark") }.buttonStyle(RoundStyle(size: 38))
        case .inPhotos:
            Button { if let u = URL(string: "photos-redirect://") { UIApplication.shared.open(u) } } label: { Image(systemName: "photo.on.rectangle") }.buttonStyle(RoundStyle(size: 38, tint: Theme.ok))
        case .inFiles(let u):
            Button { share = u } label: { Image(systemName: "square.and.arrow.up") }.buttonStyle(RoundStyle(size: 38))
        default:
            if let onSave, !used {
                if media {
                    Menu {
                        Button { onSave(false) } label: { Label("Save to Photos", systemImage: "photo.on.rectangle") }
                        Button { onSave(true) } label: { Label("Save to Files", systemImage: "folder") }
                    } label: { Image(systemName: "arrow.down").font(.system(size: 16, weight: .medium)).foregroundStyle(Theme.text)
                        .frame(width: 38, height: 38).background(Circle().fill(Theme.glass)).overlay(Circle().stroke(Theme.edge)) }
                } else {
                    Button { onSave(true) } label: { Image(systemName: "arrow.down") }.buttonStyle(RoundStyle(size: 38))
                }
            }
        }
    }
}

extension URL: Identifiable { public var id: String { absoluteString } }

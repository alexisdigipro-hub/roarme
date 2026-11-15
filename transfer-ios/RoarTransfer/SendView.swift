import SwiftUI
import UIKit

// Send: photos and videos straight from the library in their original quality (nothing made smaller), or any file
// from Files; one link for all of it.
struct SendView: View {
    @EnvironmentObject var session: Session
    @StateObject private var up = Uploader()
    @State private var picked: [Picked] = []
    @State private var notes: [String] = []
    @State private var photos = false
    @State private var files = false
    @State private var days = 1
    @State private var more = false
    @State private var title = ""
    @State private var message = ""
    @State private var password = ""
    @State private var share = false
    @State private var copied = false
    @State private var loadingPicks = false

    private var total: Int64 { picked.reduce(0) { $0 + $1.size } }
    private var limitGB: Int64 { !session.signedIn ? 1 : days == 1 ? 5 : days == 7 ? 1 : 3 }
    // only a guest is stopped here; an account's own limit (Free or Pro) is the server's to say
    private var over: Bool { !session.signedIn && total > limitGB * 1_073_741_824 }

    var body: some View {
        NavigationStack {
            ZStack {
                Backdrop()
                ScrollView {
                    VStack(spacing: 16) {
                        HStack { Wordmark(); Spacer() }.padding(.top, 8)
                        if up.busy { sending } else if let l = up.link { done(l) } else { pick }
                    }
                    .padding(.horizontal, 16).padding(.bottom, 30)
                }
                .scrollDismissesKeyboard(.interactively)
            }
            .toolbar(.hidden, for: .navigationBar)
        }
        .sheet(isPresented: $photos) { PhotoPicker { p, e in add(p, e) }.ignoresSafeArea() }
        .sheet(isPresented: $files) { FilePicker { p, e in add(p, e) }.ignoresSafeArea() }
        .sheet(isPresented: $share) { if let l = up.link { ShareSheet(items: [URL(string: l)!]).presentationDetents([.medium, .large]) } }
    }

    private func add(_ p: [Picked], _ e: [String]) {
        picked += p
        notes = e
    }

    // ---- choosing ----
    private var pick: some View {
        VStack(spacing: 16) {
            PageTitle(text: "Send big files")
            HStack(spacing: 10) {
                Button { photos = true } label: { Label("Photos & Videos", systemImage: "photo.on.rectangle").frame(maxWidth: .infinity) }.buttonStyle(PillStyle())
                Button { files = true } label: { Label("Files", systemImage: "folder").frame(maxWidth: .infinity) }.buttonStyle(PillStyle())
            }
            Text("Videos go in their original quality, exactly as they are on your iPhone.")
                .font(.system(size: 13)).foregroundStyle(Theme.dim).frame(maxWidth: .infinity, alignment: .leading).padding(.horizontal, 6)
            ForEach(notes, id: \.self) { n in Text(n).font(.system(size: 13)).foregroundStyle(Theme.redHi) }

            if !picked.isEmpty {
                VStack(spacing: 8) {
                    ForEach(picked) { f in
                        Tile(pad: 12) {
                            HStack(spacing: 12) {
                                Image(systemName: kindIcon(f.name, type: f.type)).font(.system(size: 18)).foregroundStyle(Theme.redHi)
                                    .frame(width: 44, height: 44).background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(Color.white.opacity(0.06)))
                                VStack(alignment: .leading, spacing: 3) {
                                    Text(f.name).font(.system(size: 15, weight: .medium)).foregroundStyle(Theme.text).lineLimit(1)
                                    Text(sizeText(f.size)).font(.system(size: 12, design: .monospaced)).foregroundStyle(Theme.dim)
                                }
                                Spacer()
                                Button { remove(f) } label: { Image(systemName: "trash") }.buttonStyle(RoundStyle(size: 36, tint: Theme.redHi))
                            }
                        }
                    }
                }

                Tile {
                    VStack(alignment: .leading, spacing: 12) {
                        Text("How long should it stay?").font(.system(size: 15, weight: .semibold)).foregroundStyle(Theme.text)
                        if session.signedIn {
                            HStack(spacing: 8) {
                                ForEach([1, 3, 7], id: \.self) { d in
                                    Button { days = d } label: { Text(d == 1 ? "1 day" : "\(d) days").frame(maxWidth: .infinity) }
                                        .buttonStyle(ChoiceStyle(on: days == d))
                                }
                            }
                        } else {
                            Text("24 hours, up to 1 GB without an account. Sign in under My Transfers for up to 5 GB and longer links.")
                                .font(.system(size: 13)).foregroundStyle(Theme.muted)
                        }
                        Text(session.signedIn ? sizeText(total) : "\(sizeText(total)) of \(limitGB) GB").font(.system(size: 13, design: .monospaced))
                            .foregroundStyle(over ? Theme.redHi : Theme.dim)
                    }
                }

                Tile {
                    VStack(alignment: .leading, spacing: 12) {
                        Button { withAnimation(.spring(response: 0.3)) { more.toggle() } } label: {
                            Label(more ? "Fewer options" : "Title, message, password", systemImage: more ? "chevron.up" : "slider.horizontal.3")
                        }.buttonStyle(PillStyle())
                        if more {
                            GlassField(placeholder: "Title (optional)", text: $title)
                            GlassField(placeholder: "Your message (optional)", text: $message)
                            GlassField(placeholder: "Password (optional)", text: $password, secure: true)
                        }
                    }
                }

                Button { start() } label: { Label("Get the link", systemImage: "link").frame(maxWidth: .infinity) }
                    .buttonStyle(PillStyle(main: true))
                    .disabled(over)
                    .opacity(over ? 0.5 : 1)
            }
        }
    }

    // ---- sending ----
    private var sending: some View {
        let frac = up.totalBytes > 0 ? Double(up.sentBytes) / Double(up.totalBytes) : 0
        return VStack(spacing: 16) {
            PageTitle(text: "Sending…")
            Tile {
                VStack(alignment: .leading, spacing: 12) {
                    Text(up.current).font(.system(size: 15, weight: .medium)).foregroundStyle(Theme.text).lineLimit(1)
                    ProgressBar(value: frac)
                    Text("\(Int(frac * 100))% · \(sizeText(up.sentBytes)) of \(sizeText(up.totalBytes))")
                        .font(.system(size: 13, design: .monospaced)).foregroundStyle(Theme.dim)
                    Text("Keep RoarTransfer open until it finishes.").font(.system(size: 13)).foregroundStyle(Theme.muted)
                }
            }
            Button { up.stop() } label: { Label("Stop", systemImage: "stop.fill").frame(maxWidth: .infinity) }.buttonStyle(PillStyle(danger: true))
        }
        .onAppear { UIApplication.shared.isIdleTimerDisabled = true }
        .onDisappear { UIApplication.shared.isIdleTimerDisabled = false }
    }

    // ---- done ----
    private func done(_ l: String) -> some View {
        VStack(spacing: 16) {
            PageTitle(text: up.errors.isEmpty ? "Uploaded!" : "Uploaded, with problems")
            Tile {
                VStack(alignment: .leading, spacing: 12) {
                    Text("Anyone with the link can download it.").font(.system(size: 15)).foregroundStyle(Theme.muted)
                    Text(l).font(.system(size: 15, design: .monospaced)).foregroundStyle(Theme.text).textSelection(.enabled)
                    HStack(spacing: 10) {
                        Button { UIPasteboard.general.string = l; copied = true } label: { Label(copied ? "Copied" : "Copy link", systemImage: copied ? "checkmark" : "doc.on.doc").frame(maxWidth: .infinity) }.buttonStyle(PillStyle())
                        Button { share = true } label: { Label("Share", systemImage: "square.and.arrow.up").frame(maxWidth: .infinity) }.buttonStyle(PillStyle(main: true))
                    }
                }
            }
            ForEach(up.errors, id: \.self) { e in Text(e).font(.system(size: 13)).foregroundStyle(Theme.redHi) }
            Button { reset() } label: { Label("Send more files", systemImage: "plus").frame(maxWidth: .infinity) }.buttonStyle(PillStyle())
        }
    }

    private func start() {
        copied = false
        up.send(picked, days: session.signedIn ? days : 1, title: title, message: message, password: password)
    }
    private func remove(_ f: Picked) {
        try? FileManager.default.removeItem(at: f.url.deletingLastPathComponent())
        picked.removeAll { $0.id == f.id }
    }
    private func reset() {
        picked = []; title = ""; message = ""; password = ""; more = false; up.link = nil; up.errors = []; copied = false
    }
}

struct ChoiceStyle: ButtonStyle {
    var on: Bool
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.system(size: 15, weight: on ? .semibold : .regular))
            .foregroundStyle(on ? Color.white : Theme.muted)
            .frame(height: 40)
            .background(Capsule().fill(on ? Color.white.opacity(0.16) : Color.white.opacity(0.04)))
            .overlay(Capsule().stroke(on ? Color.white.opacity(0.28) : Theme.edge, lineWidth: 1))
            .scaleEffect(configuration.isPressed ? 0.96 : 1)
            .animation(.spring(response: 0.3, dampingFraction: 0.8), value: on)
    }
}

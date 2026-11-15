import SwiftUI
import UIKit

// My transfers, as roartransfer.com: "My transfers." with the totals in one line, Sent | Received for a Pro,
// All | Active | Expired, the search, Select to delete many, one row a transfer; a row opens its window (status,
// Copy, Open, Share; for a Pro the expiry, password and Locked until paid; the activity; Delete apart in red).
// Signed out: the website's sign-in card.
struct MineView: View {
    @EnvironmentObject var session: Session
    @EnvironmentObject var lang: Lang
    @EnvironmentObject var pro: ProStore
    @State private var list: [MyTransfer]?
    @State private var listErr = ""
    @State private var side = "sent"
    @State private var filter = 0
    @State private var query = ""
    @State private var open: MyTransfer?
    @State private var picking = false
    @State private var picked: Set<String> = []
    @State private var askDelete = false
    @State private var deleting = false

    var body: some View {
        ZStack {
            ScrollView {
                Group {
                    if session.signedIn { Card { mine } } else { AuthCard() }
                }
                .padding(.horizontal, 16).padding(.top, 8).padding(.bottom, 120)
            }
            .refreshable { await load() }
            .scrollDismissesKeyboard(.interactively)

            if let m = open {
                GlassWindow(title: m.name ?? "file", close: { open = nil }) {
                    TransferWindow(m: m, isPro: pro.isPro, onChanged: { Task { await load() } }, close: { open = nil })
                }
                .zIndex(5)
            }
        }
        .task(id: session.signedIn) { if session.signedIn { await load() } else { list = nil } }
        .confirmationDialog(t("Delete these links? The files go for good."), isPresented: $askDelete, titleVisibility: .visible) {
            Button(t("Delete") + " (\(picked.count))", role: .destructive) { deleteMany() }
            Button(t("Cancel"), role: .cancel) {}
        }
    }

    private var all: [MyTransfer] { (list ?? []).filter { !($0.stopped ?? false) } }
    private var shown: [MyTransfer] {
        let byFilter = filter == 1 ? all.filter { $0.live } : filter == 2 ? all.filter { !$0.live } : all
        let q = query.trimmingCharacters(in: .whitespaces).lowercased()
        return q.isEmpty ? byFilter : byFilter.filter { m in ([m.name] + (m.files ?? []).map { $0.name }).contains { ($0 ?? "").lowercased().contains(q) } }
    }
    private func pickable(_ m: MyTransfer) -> Bool { m.live && m.source == "link" && m.paths.contains { $0.range(of: "^(free|week|pro)/", options: .regularExpression) != nil } }
    private var facts: String {
        guard !all.isEmpty else { return "" }
        let size = all.reduce(Int64(0)) { $0 + Int64($1.size ?? 0) }
        let dls = all.reduce(0) { $0 + Int($1.downloads ?? 0) }
        let act = all.filter { $0.live }.count
        return ["\(all.count) \(all.count == 1 ? t("transfer") : t("transfers"))", sizeText(size), "\(act) \(t("active now"))", "\(dls) \(dls == 1 ? t("download") : t("downloads"))"].joined(separator: " · ")
    }

    private var mine: some View {
        VStack(spacing: 14) {
            HStack(spacing: 8) {
                LightBoldTitle(light: lang.el ? "Οι " : "My ", bold: lang.el ? "αποστολές μου." : "transfers.")
                if pro.isPro { ProBadge() }
            }
            if pro.isPro {
                Segments(items: [("sent", t("Sent"), nil), ("got", t("Received") + ((pro.info?.received?.count ?? 0) > 0 ? " \(pro.info!.received!.count)" : ""), nil)], value: $side, height: 42)
            }
            if side == "got" && pro.isPro { received } else { sent }
        }
    }

    // ---- what I sent ----
    @ViewBuilder private var sent: some View {
        if !facts.isEmpty { Text(facts).font(.system(size: 13)).foregroundStyle(Theme.muted).multilineTextAlignment(.center) }
        Segments(items: [(0, t("All"), nil), (1, t("Active"), nil), (2, t("Expired"), nil)], value: $filter)
        HStack(spacing: 8) {
            GlassField(placeholder: t("Search by file"), text: $query)
            if shown.contains(where: pickable) || picking {
                Button { withAnimation(Glass.spring) { picking.toggle(); picked = [] } } label: {
                    Label(picking ? t("Cancel") : t("Select"), systemImage: picking ? "xmark" : "checkmark")
                }.buttonStyle(PillStyle())
            }
        }
        if picking {
            HStack {
                Text("\(picked.count) \(t("selected"))").font(.system(size: 14)).foregroundStyle(Theme.muted)
                Spacer()
                Button { picked = Set(shown.filter(pickable).map { $0.id }) } label: { Text(t("All")) }.buttonStyle(SmallPill())
                Button { askDelete = true } label: { Label(t("Delete"), systemImage: "trash") }.buttonStyle(PillStyle(danger: true)).disabled(picked.isEmpty || deleting)
            }
            .transition(.glassDrop)
        }
        if !listErr.isEmpty { Text(listErr).font(.system(size: 14)).foregroundStyle(Theme.redHi) }
        if list == nil { ProgressView().tint(Theme.text).padding(30) }
        else if shown.isEmpty {
            Text(all.isEmpty ? t("Nothing sent yet. What you send shows here.") : t("Nothing found.")).font(.system(size: 15)).foregroundStyle(Theme.muted).multilineTextAlignment(.center).padding(24)
        } else {
            LazyVStack(spacing: 8) {
                ForEach(shown) { m in
                    Button { tap(m) } label: { row(m) }.buttonStyle(PressRow()).transition(.glassDrop)
                }
            }
        }
    }

    private func tap(_ m: MyTransfer) {
        if picking {
            guard pickable(m) else { return }
            Glass.tap(.soft)
            if picked.contains(m.id) { picked.remove(m.id) } else { picked.insert(m.id) }
        } else { open = m }
    }

    private func row(_ m: MyTransfer) -> some View {
        HStack(spacing: 12) {
            if picking {
                Image(systemName: picked.contains(m.id) ? "checkmark.circle.fill" : "circle")
                    .font(.system(size: 22)).foregroundStyle(picked.contains(m.id) ? Theme.redHi : (pickable(m) ? Theme.muted : Theme.dim.opacity(0.4)))
            }
            Image(systemName: kindIcon(m.name ?? "", type: m.type)).font(.system(size: 16)).foregroundStyle(m.live ? Theme.redHi : Theme.dim)
                .frame(width: 40, height: 40).background(RoundedRectangle(cornerRadius: 11, style: .continuous).fill(m.live ? Theme.red.opacity(0.18) : Color.white.opacity(0.06)))
            VStack(alignment: .leading, spacing: 2) {
                Text(m.name ?? "file").font(.system(size: 15, weight: .semibold)).foregroundStyle(m.live ? Theme.text : Theme.muted).lineLimit(1)
                HStack(spacing: 5) {
                    if m.live, let d = Dates.parse(m.expires), d.timeIntervalSinceNow < 86400 { Circle().fill(Color.yellow).frame(width: 6, height: 6) }
                    Text([sizeText(Int64(m.size ?? 0)), m.deleted == true ? t("Deleted") : m.live ? leftText(m.expires) : t("Expired"), "\(Int(m.downloads ?? 0)) \(Int(m.downloads ?? 0) == 1 ? t("download") : t("downloads"))"].joined(separator: " · "))
                        .font(.system(size: 12, design: .monospaced)).foregroundStyle(Theme.dim).lineLimit(1)
                }
            }
            Spacer(minLength: 6)
            if !picking { Image(systemName: "chevron.right").font(.system(size: 13, weight: .semibold)).foregroundStyle(Theme.dim) }
        }
        .padding(10)
        .background(RoundedRectangle(cornerRadius: 18, style: .continuous).fill(Color.black.opacity(0.22)))
        .overlay(RoundedRectangle(cornerRadius: 18, style: .continuous).stroke(picked.contains(m.id) ? Theme.red.opacity(0.6) : Theme.edge))
        .contentShape(Rectangle())
    }

    // ---- what came to a Pro's page ----
    @ViewBuilder private var received: some View {
        let got = pro.info?.received ?? []
        if got.isEmpty {
            Text(t("Nothing received yet. Your page's link is in Settings: send it to someone and their files show up here."))
                .font(.system(size: 15)).foregroundStyle(Theme.muted).multilineTextAlignment(.center).padding(24)
        } else {
            LazyVStack(spacing: 8) {
                ForEach(got) { g in
                    HStack(spacing: 12) {
                        Image(systemName: "arrow.down").font(.system(size: 16, weight: .semibold)).foregroundStyle(Theme.redHi)
                            .frame(width: 40, height: 40).background(RoundedRectangle(cornerRadius: 11, style: .continuous).fill(Theme.red.opacity(0.18)))
                        VStack(alignment: .leading, spacing: 2) {
                            Text(g.sender_name ?? "").font(.system(size: 15, weight: .semibold)).foregroundStyle(Theme.text).lineLimit(1)
                            Text([g.sender_email ?? "", "\(Int(g.files ?? 0)) \(t("files"))", sizeText(Int64(g.bytes ?? 0)), Dates.short(g.created_at)].filter { !$0.isEmpty }.joined(separator: " · "))
                                .font(.system(size: 12)).foregroundStyle(Theme.dim).lineLimit(2)
                            if let msg = g.message, !msg.isEmpty { Text(msg).font(.system(size: 13)).foregroundStyle(Theme.muted).lineLimit(3) }
                        }
                        Spacer(minLength: 6)
                        if let b = g.bundle {
                            Button { Router.shared?.open(Config.page + b) } label: { Image(systemName: "arrow.down.circle") }.buttonStyle(RoundStyle(size: 36))
                        }
                    }
                    .padding(10)
                    .background(RoundedRectangle(cornerRadius: 18, style: .continuous).fill(Color.black.opacity(0.22)))
                    .overlay(RoundedRectangle(cornerRadius: 18, style: .continuous).stroke(Theme.edge))
                    .transition(.glassDrop)
                }
            }
        }
    }

    private func load() async {
        do { let l = try await API.myTransfersByUpload(); withAnimation(Glass.spring) { list = l }; listErr = "" }
        catch { listErr = error.localizedDescription; if list == nil { list = [] } }
        await pro.load()
    }

    private func deleteMany() {
        deleting = true
        let paths = (list ?? []).filter { picked.contains($0.id) }.flatMap { $0.paths }.filter { !$0.hasPrefix("bundle:") }
        Task {
            for p in paths { _ = try? await API.bridge(["action": "delete", "key": p], as: AnyCodable.self) }
            deleting = false; picked = []; withAnimation(Glass.spring) { picking = false }
            Glass.tap(.medium)
            await load()
        }
    }
}

@MainActor
func leftText(_ s: String?) -> String {
    guard let d = Dates.parse(s) else { return "" }
    let secs = d.timeIntervalSinceNow
    if secs <= 0 { return t("Ended") }
    let h = Int(secs / 3600)
    if h < 24 { return "\(max(h, 1)) h \(t("left"))" }
    let days = h / 24
    return Lang.shared.el ? "\(days) \(days == 1 ? "μέρα" : "μέρες") \(t("left"))" : "\(days) day\(days == 1 ? "" : "s") left"
}

// one transfer's window, as the website's: what it is, Copy / Open / Share, for a Pro its expiry, password and
// Locked until paid, the activity (who opened and downloaded, when, from where), Delete apart in red
struct TransferWindow: View {
    var m: MyTransfer
    var isPro: Bool
    var onChanged: () -> Void
    var close: () -> Void
    @State private var copied = false
    @State private var share = false
    @State private var asking = false
    @State private var err = ""
    @State private var det: LinkDetails?
    @State private var until = Date()
    @State private var pw = ""
    @State private var payLock = false
    @State private var busy = false
    @State private var saved = ""
    @State private var activity = false
    @State private var mailOpen = false
    @State private var mailTo = ""
    @State private var mailMsg = ""
    @State private var mailBusy = false
    @State private var mailDone = ""
    private var link: String? { m.token.map { Config.page + $0 } }

    var body: some View {
        VStack(spacing: 14) {
            Image(systemName: kindIcon(m.name ?? "", type: m.type)).font(.system(size: 22)).foregroundStyle(Theme.redHi)
                .frame(width: 56, height: 56).background(RoundedRectangle(cornerRadius: 16, style: .continuous).fill(Theme.red.opacity(0.18)))
            Text([sizeText(Int64(m.size ?? 0)), Dates.short(m.created_at)].filter { !$0.isEmpty }.joined(separator: " · "))
                .font(.system(size: 13, design: .monospaced)).foregroundStyle(Theme.dim)
            HStack(spacing: 6) {
                Circle().fill(m.live ? Theme.ok : Theme.dim).frame(width: 8, height: 8)
                Text((m.live ? t("Active") + " · " + leftText(m.expires) : t("Expired")) + " · \(Int(m.downloads ?? 0)) \(t("downloads"))" + (Int(m.opens ?? 0) > 0 ? " · \(Int(m.opens ?? 0)) \(t("opens"))" : ""))
                    .font(.system(size: 13)).foregroundStyle(Theme.muted)
            }
            if m.live, let link {
                HStack(spacing: 10) {
                    Button { UIPasteboard.general.string = link; copied = true; Glass.tap(.soft) } label: { Label(copied ? t("Copied") : t("Copy link"), systemImage: copied ? "checkmark" : "link").frame(maxWidth: .infinity) }.buttonStyle(PillStyle(main: true))
                    Button { if let u = URL(string: link) { UIApplication.shared.open(u) } } label: { Label(t("Open"), systemImage: "eye").frame(maxWidth: .infinity) }.buttonStyle(PillStyle())
                }
                HStack(spacing: 10) {
                    Button { share = true } label: { Label(t("Share"), systemImage: "square.and.arrow.up").frame(maxWidth: .infinity) }.buttonStyle(PillStyle())
                    Button { withAnimation(Glass.spring) { mailOpen.toggle(); mailDone = "" } } label: { Label(t("Send by email"), systemImage: "envelope").frame(maxWidth: .infinity) }.buttonStyle(PillStyle())
                }
                // send it again, to the same people or anyone (Alex, 15 Nov): an email with a link to all its files
                if mailOpen {
                    VStack(spacing: 10) {
                        GlassField(placeholder: t("Send to: emails, separated by commas"), text: $mailTo, keyboard: .emailAddress)
                        GlassField(placeholder: t("Your message (optional)"), text: $mailMsg)
                        Button { sendMail() } label: {
                            HStack { if mailBusy { ProgressView().tint(.white) }; Label(t("Send"), systemImage: "paperplane") }.frame(maxWidth: .infinity)
                        }.buttonStyle(PillStyle(main: true)).disabled(mailBusy || mailTo.trimmingCharacters(in: .whitespaces).isEmpty)
                    }.transition(.glassDrop)
                }
                if !mailDone.isEmpty { Text(mailDone).font(.system(size: 13)).foregroundStyle(Theme.ok).multilineTextAlignment(.center) }
            }

            // an upload of many: its files, under the one link
            if let fs = m.files, fs.count > 1 {
                VStack(spacing: 0) {
                    ForEach(Array(fs.enumerated()), id: \.offset) { i, f in
                        if i > 0 { Divider().overlay(Theme.edge) }
                        HStack(spacing: 10) {
                            Image(systemName: kindIcon(f.name ?? "", type: f.type)).font(.system(size: 14)).foregroundStyle(Theme.redHi).frame(width: 20)
                            Text(f.name ?? "file").font(.system(size: 14)).foregroundStyle(Theme.text).lineLimit(1)
                            Spacer()
                            Text(sizeText(Int64(f.size ?? 0))).font(.system(size: 12, design: .monospaced)).foregroundStyle(Theme.dim)
                        }.padding(.horizontal, 12).padding(.vertical, 9)
                    }
                }
                .background(RoundedRectangle(cornerRadius: 16, style: .continuous).fill(Color.black.opacity(0.22)))
                .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous).stroke(Theme.edge))
            }
            if isPro && m.proToken != nil && m.source == "link" { proPart }

            if m.live && m.source == "link" {
                Button { asking = true } label: { Label(t("Delete"), systemImage: "trash").frame(maxWidth: .infinity) }.buttonStyle(PillStyle(danger: true)).padding(.top, 6)
            }
            if !err.isEmpty { Text(err).font(.system(size: 13)).foregroundStyle(Theme.redHi) }
        }
        .sheet(isPresented: $share) { if let l = link, let u = URL(string: l) { ShareSheet(items: [u]).presentationDetents([.medium, .large]) } }
        .confirmationDialog(t("Delete this link? The file goes for good."), isPresented: $asking, titleVisibility: .visible) {
            Button(t("Delete"), role: .destructive) { delete() }
            Button(t("Cancel"), role: .cancel) {}
        }
        .task { await loadDetails() }
    }

    @ViewBuilder private var proPart: some View {
        if let d = det {
            if m.live {
                RowBox {
                    HStack {
                        VStack(alignment: .leading, spacing: 2) {
                            Text(t("Expires")).font(.system(size: 15)).foregroundStyle(Theme.text)
                            if let mx = Dates.parse(d.max) { Text(t("at most until") + " " + Dates.short(d.max)).font(.system(size: 11)).foregroundStyle(Theme.muted).id(mx) }
                        }
                        Spacer()
                        DatePicker("", selection: $until, in: Date()...(Dates.parse(d.max) ?? Date().addingTimeInterval(30 * 86400)), displayedComponents: [.date, .hourAndMinute])
                            .labelsHidden().tint(Theme.redHi)
                    }.padding(.horizontal, 14).padding(.vertical, 8)
                    if d.bundle != nil {
                        Divider().overlay(Theme.edge)
                        HStack {
                            VStack(alignment: .leading, spacing: 2) {
                                Text(t("Password")).font(.system(size: 15)).foregroundStyle(Theme.text)
                                Text(d.locked == true ? t("Has a password") : t("No password")).font(.system(size: 11)).foregroundStyle(Theme.muted)
                            }
                            Spacer()
                            SecureField("", text: $pw, prompt: Text(t("New password")).foregroundColor(Theme.dim)).multilineTextAlignment(.trailing).foregroundStyle(Theme.text).frame(maxWidth: 150)
                        }.padding(.horizontal, 14).padding(.vertical, 10)
                    }
                    if d.payLock != nil {
                        Divider().overlay(Theme.edge)
                        SwitchRow(title: t("Locked until paid"), sub: payLock ? t("The link shows what it holds but opens nothing.") : t("Off"), on: Binding(get: { payLock }, set: { v in payLock = v; savePay(v) }))
                    }
                }
                let changed = (Dates.parse(d.expires).map { abs($0.timeIntervalSince(until)) > 59 } ?? false) || !pw.isEmpty
                if changed {
                    Button { save(pwOff: false) } label: { HStack { if busy { ProgressView().tint(.white) }; Text(t("Save changes")) }.frame(maxWidth: .infinity) }
                        .buttonStyle(PillStyle(main: true)).disabled(busy).transition(.glassDrop)
                }
                if d.bundle != nil && d.locked == true {
                    Button { save(pwOff: true) } label: { Text(t("Remove the password")) }.buttonStyle(SmallPill())
                }
                if !saved.isEmpty { Text(saved).font(.system(size: 13)).foregroundStyle(Theme.ok) }
            }
            let ev = d.events ?? []
            Button { withAnimation(Glass.spring) { activity.toggle() } } label: {
                HStack { Text(t("Activity")).foregroundStyle(Theme.text); Text(ev.isEmpty ? t("none yet") : "\(ev.count)").foregroundStyle(Theme.muted); Spacer(); Image(systemName: activity ? "chevron.up" : "chevron.down").foregroundStyle(Theme.dim) }
                    .font(.system(size: 15)).padding(14)
                    .background(RoundedRectangle(cornerRadius: 18, style: .continuous).fill(Color.black.opacity(0.22))).overlay(RoundedRectangle(cornerRadius: 18, style: .continuous).stroke(Theme.edge))
            }.buttonStyle(PressRow()).disabled(ev.isEmpty)
            if activity {
                VStack(alignment: .leading, spacing: 8) {
                    ForEach(Array(ev.enumerated()), id: \.offset) { _, e in
                        VStack(alignment: .leading, spacing: 1) {
                            Text(e.kind == "download" ? t("Downloaded") : t("Opened")).font(.system(size: 14, weight: .semibold)).foregroundStyle(Theme.text)
                            Text([Dates.short(e.at), countryName(e.country), e.device ?? ""].filter { !$0.isEmpty }.joined(separator: " · ")).font(.system(size: 12)).foregroundStyle(Theme.muted)
                        }
                    }
                }.frame(maxWidth: .infinity, alignment: .leading).padding(.horizontal, 6).transition(.glassDrop)
            }
        } else {
            ProgressView().tint(Theme.text)
        }
    }

    private func countryName(_ c: String?) -> String {
        guard let c, !c.isEmpty else { return "" }
        return Locale(identifier: Lang.shared.el ? "el" : "en").localizedString(forRegionCode: c) ?? c
    }

    private func loadDetails() async {
        guard isPro, let tok = m.proToken, m.source == "link" else { return }
        if let d = try? await API.pro(["action": "link", "token": tok], as: LinkDetails.self) {
            withAnimation(Glass.spring) { det = d }
            until = Dates.parse(d.expires) ?? Date()
            payLock = d.payLock ?? false
        }
    }

    private func save(pwOff: Bool) {
        guard let tok = m.proToken, let d = det else { return }
        var body: [String: Any] = ["action": "edit", "token": tok]
        if let e = Dates.parse(d.expires), abs(e.timeIntervalSince(until)) > 59 { body["until"] = ISO8601DateFormatter().string(from: until) }
        if pwOff { body["password"] = "" } else if !pw.isEmpty { body["password"] = pw }
        busy = true; saved = ""; err = ""
        Task {
            do {
                let r = try await API.pro(body, as: EditReply.self)
                if let u = r.until { det?.expires = u }
                if let l = r.locked { det?.locked = l }
                pw = ""; saved = t("Saved."); Glass.tap(.medium); onChanged()
            } catch { err = t(error.localizedDescription) }
            busy = false
        }
    }

    private func savePay(_ on: Bool) {
        guard let tok = m.proToken else { return }
        Task {
            do {
                let r = try await API.pro(["action": "edit", "token": tok, "payLock": on], as: EditReply.self)
                if let p = r.payLock { payLock = p; det?.payLock = p }
                saved = t("Saved.")
            } catch { payLock = !on; err = t(error.localizedDescription) }
        }
    }

    private func sendMail() {
        let to = mailTo.split(whereSeparator: { $0 == "," || $0 == " " || $0 == ";" || $0 == "\n" }).map(String.init).filter { $0.contains("@") }
        let tokens = (m.files?.compactMap { $0.token }) ?? [m.token].compactMap { $0 }
        guard !to.isEmpty, !tokens.isEmpty else { err = t("Add at least one email to send to."); return }
        mailBusy = true; err = ""; mailDone = ""
        Task {
            do {
                // a new link to the same files, mailed to them (roartransfer-r2 'bundle', as the website's Send by email)
                struct Reply: Decodable { var mailed: Int?; var mailErrors: [String]? }
                let r = try await API.bridge(["action": "bundle", "tokens": tokens, "title": m.title ?? "", "message": mailMsg, "recipients": to, "notify": true], as: Reply.self)
                let n = r.mailed ?? 0
                if n > 0 { mailDone = t("Sent by email to") + " \(n)."; mailTo = ""; mailMsg = ""; Glass.tap(.medium); withAnimation(Glass.spring) { mailOpen = false } }
                if let e = r.mailErrors, !e.isEmpty { err = e.joined(separator: "\n") }
                if n == 0 && (r.mailErrors ?? []).isEmpty { err = t("Could not send the email. Try again.") }
            } catch { err = t(error.localizedDescription) }
            mailBusy = false
        }
    }

    private func delete() {
        let ps = m.paths.filter { !$0.hasPrefix("bundle:") }
        guard !ps.isEmpty else { return }
        Task {
            do {
                for p in ps { _ = try await API.bridge(["action": "delete", "key": p], as: AnyCodable.self) }
                Glass.tap(.medium); onChanged(); close()
            } catch { err = error.localizedDescription }
        }
    }
}

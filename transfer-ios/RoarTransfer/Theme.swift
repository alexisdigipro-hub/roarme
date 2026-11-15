import SwiftUI

// roartransfer.com's look: graphite, soft glass tiles, red that glows, round glass buttons and pills.
// Never a word with an underline as a button: every action is a pill or a round glass icon.
enum Theme {
    static let bg = Color(red: 0.086, green: 0.094, blue: 0.110)
    static let text = Color(red: 0.933, green: 0.941, blue: 0.953)
    static let muted = Color(red: 0.84, green: 0.86, blue: 0.89).opacity(0.62)
    static let dim = Color(red: 0.84, green: 0.86, blue: 0.89).opacity(0.4)
    static let red = Color(red: 0.831, green: 0, blue: 0)
    static let redHi = Color(red: 1, green: 0.231, blue: 0.184)
    static let ok = Color(red: 0.184, green: 0.827, blue: 0.42)
    static let glass = Color.white.opacity(0.055)
    static let edge = Color.white.opacity(0.12)
}

struct Backdrop: View {
    var body: some View {
        ZStack {
            Theme.bg
            RadialGradient(colors: [Theme.red.opacity(0.16), .clear], center: .init(x: 0.5, y: -0.05), startRadius: 0, endRadius: 520)
            RadialGradient(colors: [Color.white.opacity(0.05), .clear], center: .init(x: 0.1, y: 1.1), startRadius: 0, endRadius: 500)
        }
        .ignoresSafeArea()
    }
}

struct Tile<Content: View>: View {
    var pad: CGFloat = 16
    @ViewBuilder var content: Content
    var body: some View {
        content
            .padding(pad)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(RoundedRectangle(cornerRadius: 22, style: .continuous).fill(Theme.glass))
            .overlay(RoundedRectangle(cornerRadius: 22, style: .continuous).stroke(Theme.edge, lineWidth: 1))
    }
}

struct PillStyle: ButtonStyle {
    var main = false
    var danger = false
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.system(size: 16, weight: .semibold))
            .foregroundStyle(main ? Color.white : (danger ? Theme.redHi : Theme.text))
            .padding(.horizontal, 20)
            .frame(minHeight: main ? 54 : 44)
            .background(
                Capsule().fill(main ? AnyShapeStyle(LinearGradient(colors: [Theme.redHi, Theme.red], startPoint: .top, endPoint: .bottom)) : AnyShapeStyle(Theme.glass))
            )
            .overlay(Capsule().stroke(main ? Color.white.opacity(0.18) : Theme.edge, lineWidth: 1))
            .shadow(color: main ? Theme.red.opacity(0.45) : .clear, radius: 16, y: 8)
            .scaleEffect(configuration.isPressed ? 0.97 : 1)
            .opacity(configuration.isPressed ? 0.9 : 1)
            .animation(.spring(response: 0.25, dampingFraction: 0.8), value: configuration.isPressed)
    }
}

struct RoundStyle: ButtonStyle {
    var size: CGFloat = 40
    var tint: Color = Theme.text
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.system(size: size * 0.42, weight: .medium))
            .foregroundStyle(tint)
            .frame(width: size, height: size)
            .background(Circle().fill(Theme.glass))
            .overlay(Circle().stroke(Theme.edge, lineWidth: 1))
            .scaleEffect(configuration.isPressed ? 0.92 : 1)
            .animation(.spring(response: 0.25, dampingFraction: 0.8), value: configuration.isPressed)
    }
}

struct GlassField: View {
    var placeholder: String
    @Binding var text: String
    var secure = false
    var keyboard: UIKeyboardType = .default
    var body: some View {
        Group {
            if secure { SecureField("", text: $text, prompt: Text(placeholder).foregroundColor(Theme.dim)) }
            else { TextField("", text: $text, prompt: Text(placeholder).foregroundColor(Theme.dim)).keyboardType(keyboard) }
        }
        .textInputAutocapitalization(.never)
        .autocorrectionDisabled()
        .font(.system(size: 16))
        .foregroundStyle(Theme.text)
        .padding(.horizontal, 18)
        .frame(height: 50)
        .background(Capsule().fill(Theme.glass))
        .overlay(Capsule().stroke(Theme.edge, lineWidth: 1))
    }
}

struct Wordmark: View {
    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            (Text("ROAR").font(.system(size: 24, weight: .light)) + Text("TRANSFER").font(.system(size: 24, weight: .heavy)))
                .foregroundStyle(Theme.text).kerning(0.5)
            (Text("BY THE").font(.system(size: 9, weight: .regular)) + Text("MAD").font(.system(size: 9, weight: .heavy)) + Text("LIONS").font(.system(size: 9, weight: .regular)))
                .foregroundStyle(Theme.muted).kerning(3)
        }
    }
}

struct PageTitle: View {
    var text: String
    var body: some View {
        Text(text).font(.system(size: 30, weight: .bold)).foregroundStyle(Theme.text)
            .frame(maxWidth: .infinity, alignment: .leading)
    }
}

struct ProgressBar: View {
    var value: Double
    var body: some View {
        GeometryReader { g in
            ZStack(alignment: .leading) {
                Capsule().fill(Color.white.opacity(0.08))
                Capsule().fill(LinearGradient(colors: [Theme.redHi, Theme.red], startPoint: .leading, endPoint: .trailing))
                    .frame(width: max(6, g.size.width * min(max(value, 0), 1)))
            }
        }
        .frame(height: 6)
        .animation(.easeOut(duration: 0.25), value: value)
    }
}

func kindIcon(_ name: String, type: String?) -> String {
    let t = type ?? "", e = (name as NSString).pathExtension.lowercased()
    if t.hasPrefix("video/") || ["mov", "mp4", "m4v"].contains(e) { return "film" }
    if t.hasPrefix("image/") || ["jpg", "jpeg", "png", "heic", "gif", "webp"].contains(e) { return "photo" }
    if t.hasPrefix("audio/") || ["wav", "mp3", "aif", "aiff", "m4a"].contains(e) { return "waveform" }
    if ["zip", "rar", "7z"].contains(e) { return "doc.zipper" }
    if e == "pdf" { return "doc.richtext" }
    return "doc"
}

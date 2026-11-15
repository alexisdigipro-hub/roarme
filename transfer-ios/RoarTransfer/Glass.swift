import SwiftUI
import UIKit

// RoarMe's liquid glass family, in SwiftUI (roarme CLAUDE.md, GLASS TRAVEL and its sisters), same timings and curves:
//  GLASS TRAVEL  a lens moving between choices: 150 ms lift and stretch with the colours split at its rim
//                (red left, blue right, green above, yellow below), then 300 ms landing with one small overshoot.
//  GLASS PRESS   what a finger is on sinks a little, the split colours at its rim, a light tap.
//  GLASS MORPH   a window grows out like a drop, with the split rim, and settles.
//  GLASS DROP    a row or a picked file comes in as a drop.
// All off with Reduce Motion.

enum Glass {
    static let lift = Animation.timingCurve(0.3, 0.7, 0.4, 1, duration: 0.15)
    static let land = Animation.timingCurve(0.25, 1.45, 0.45, 1, duration: 0.3)
    static let spring = Animation.spring(response: 0.42, dampingFraction: 0.68)
    static var calm: Bool { UIAccessibility.isReduceMotionEnabled }
    static func tap(_ s: UIImpactFeedbackGenerator.FeedbackStyle = .light) { UIImpactFeedbackGenerator(style: s).impactOccurred() }
}

// the split colours at a rim, as thin coloured shadows
struct ChromaRim: ViewModifier {
    var on: Bool
    var strength: CGFloat = 1
    func body(content: Content) -> some View {
        content
            .shadow(color: Color.red.opacity(on ? 0.55 * strength : 0), radius: 0.6, x: on ? -1.6 * strength : 0)
            .shadow(color: Color.blue.opacity(on ? 0.55 * strength : 0), radius: 0.6, x: on ? 1.6 * strength : 0)
            .shadow(color: Color.green.opacity(on ? 0.3 * strength : 0), radius: 0.6, y: on ? -1 * strength : 0)
            .shadow(color: Color.yellow.opacity(on ? 0.3 * strength : 0), radius: 0.6, y: on ? 1 * strength : 0)
    }
}

// GLASS PRESS: in at once, out on the same spring
struct GlassPress<S: Shape>: ViewModifier {
    var pressed: Bool
    var shape: S
    func body(content: Content) -> some View {
        content
            .overlay(shape.stroke(Color.white.opacity(pressed ? 0.35 : 0), lineWidth: 1).modifier(ChromaRim(on: pressed && !Glass.calm)))
            .scaleEffect(pressed && !Glass.calm ? 0.95 : 1)
            .brightness(pressed ? 0.04 : 0)
            .animation(pressed ? .easeOut(duration: 0.07) : Glass.land, value: pressed)
            .onChange(of: pressed) { p in if p { Glass.tap() } }
    }
}
extension View {
    func glassPress<S: Shape>(_ pressed: Bool, shape: S) -> some View { modifier(GlassPress(pressed: pressed, shape: shape)) }
}

// GLASS DROP: what comes in arrives as a drop
extension AnyTransition {
    static var glassDrop: AnyTransition {
        Glass.calm ? .opacity : .asymmetric(insertion: .scale(scale: 0.86).combined(with: .opacity).combined(with: .offset(y: 8)), removal: .scale(scale: 0.92).combined(with: .opacity))
    }
}

// GLASS TRAVEL: one glass pill of choices with a lens that travels (Email | Link, the days, All | Active | Expired, EN | GR)
struct Segments<T: Hashable>: View {
    var items: [(T, String, String?)]   // value, title, a second line, or an SF Symbol as "sf:name"
    @Binding var value: T
    var height: CGFloat = 46
    @Namespace private var ns
    @State private var going = false

    var body: some View {
        HStack(spacing: 4) {
            ForEach(Array(items.enumerated()), id: \.offset) { _, it in
                Button { pick(it.0) } label: {
                    VStack(spacing: 1) {
                        if let sub = it.2, sub.hasPrefix("sf:") {
                            Label(it.1, systemImage: String(sub.dropFirst(3))).font(.system(size: 15, weight: value == it.0 ? .semibold : .regular))
                        } else {
                            Text(it.1).font(.system(size: 15, weight: value == it.0 ? .semibold : .regular))
                            if let sub = it.2 { Text(sub).font(.system(size: 11)).foregroundStyle(Theme.muted) }
                        }
                    }
                    .lineLimit(1).minimumScaleFactor(0.75)
                    .foregroundStyle(value == it.0 ? Theme.text : Theme.muted)
                    .frame(maxWidth: .infinity, minHeight: height - 8)
                    .background {
                        if value == it.0 { Lens(going: going).matchedGeometryEffect(id: "lens", in: ns) }
                    }
                    .contentShape(Capsule())
                }
                .buttonStyle(.plain)
            }
        }
        .padding(4)
        .background(Capsule().fill(Color.black.opacity(0.28)))
        .overlay(Capsule().stroke(Theme.edge, lineWidth: 1))
    }

    private func pick(_ v: T) {
        guard v != value else { return }
        Glass.tap(.soft)
        if Glass.calm { value = v; return }
        withAnimation(Glass.lift) { going = true }
        withAnimation(Glass.spring) { value = v }
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.15) { withAnimation(Glass.land) { going = false } }
    }
}

// the travelling lens: lighter glass that lifts and stretches while it goes
struct Lens: View {
    var going: Bool
    var body: some View {
        Capsule().fill(Color.white.opacity(going ? 0.24 : 0.16))
            .overlay(Capsule().stroke(Color.white.opacity(going ? 0.4 : 0.22), lineWidth: 1))
            .modifier(ChromaRim(on: going))
            .scaleEffect(x: going ? 1.03 : 1, y: going ? 1.16 : 1)
    }
}

// The menu at the foot, exactly as RoarMe's (Frost by Night, Alex's screenshot, 15 Nov): a warm frosted glass
// capsule with a bright rim, white line icons over white words, the chosen one in a lighter glass pill with its own
// rim and shadow, and a thread of light leaking along the bar's bottom edge. The pill travels (GLASS TRAVEL).
struct FootMenu<T: Hashable>: View {
    // value, word (for VoiceOver), the SF Symbol; the chosen one wears its .fill form (Alex, 15 Nov: icons only, smaller,
    // as his reference: a slim dark glass capsule, the chosen sign white and filled in a soft glass pill, the rest thin lines)
    var items: [(T, String, String)]
    @Binding var value: T
    @Namespace private var ns
    @State private var going = false
    @State private var popped: T?

    var body: some View {
        HStack(spacing: 0) {
            ForEach(Array(items.enumerated()), id: \.offset) { _, it in
                let on = value == it.0
                Button { pick(it.0) } label: {
                    Image(systemName: on ? it.2 + ".fill" : it.2)
                        .font(.system(size: 21, weight: on ? .semibold : .regular))
                        .symbolRenderingMode(.monochrome)
                        .foregroundStyle(on ? Color.white : Color.white.opacity(0.62))
                        .scaleEffect(popped == it.0 ? 1.14 : 1)
                        .frame(maxWidth: .infinity, minHeight: 50)
                        .background {
                            if on {
                                Capsule()
                                    .fill(Color.white.opacity(going ? 0.2 : 0.14))
                                    .overlay(Capsule().stroke(Color.white.opacity(0.1), lineWidth: 0.8))
                                    .modifier(ChromaRim(on: going))
                                    .scaleEffect(x: going ? 1.03 : 1, y: going ? 1.12 : 1)
                                    .matchedGeometryEffect(id: "foot", in: ns)
                            }
                        }
                        .contentShape(Capsule())
                }
                .buttonStyle(FootPress())
                .accessibilityLabel(it.1)
                .accessibilityAddTraits(on ? .isSelected : [])
            }
        }
        .padding(5)
        .background {
            ZStack {
                Capsule().fill(.ultraThinMaterial)
                Capsule().fill(Color(red: 0.08, green: 0.09, blue: 0.1).opacity(0.55))
            }
        }
        .overlay(Capsule().stroke(LinearGradient(colors: [Color.white.opacity(0.28), Color.white.opacity(0.08), Color.white.opacity(0.18)], startPoint: .top, endPoint: .bottom), lineWidth: 1))
        .shadow(color: .black.opacity(0.45), radius: 18, y: 10)
    }

    private func pick(_ v: T) {
        guard v != value else { return }
        Glass.tap(.soft)
        if Glass.calm { value = v; return }
        withAnimation(Glass.lift) { going = true }
        withAnimation(Glass.spring) { value = v }
        withAnimation(.spring(response: 0.25, dampingFraction: 0.45)) { popped = v }
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.15) { withAnimation(Glass.land) { going = false } }
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.32) { withAnimation(Glass.land) { popped = nil } }
    }
}

struct FootPress: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .scaleEffect(configuration.isPressed && !Glass.calm ? 0.92 : 1)
            .animation(configuration.isPressed ? .easeOut(duration: 0.07) : Glass.land, value: configuration.isPressed)
    }
}

// GLASS MORPH: our own window, over everything, that grows out as a drop with the split rim and settles; a tap
// beside it or the X closes it. Used for More options, a transfer's window, sign-in steps and the legal pages.
struct GlassWindow<Content: View>: View {
    var title: String
    var close: () -> Void
    @ViewBuilder var content: Content
    @State private var shown = false

    var body: some View {
        ZStack {
            Color.black.opacity(shown ? 0.45 : 0).ignoresSafeArea().onTapGesture { dismiss() }
            VStack(spacing: 0) {
                HStack {
                    Text(title).font(.system(size: 18, weight: .bold)).foregroundStyle(Theme.text).lineLimit(1)
                    Spacer()
                    Button { dismiss() } label: { Image(systemName: "xmark") }.buttonStyle(RoundStyle(size: 34))
                }
                .padding(.horizontal, 18).padding(.top, 16).padding(.bottom, 8)
                ScrollView { content.padding(.horizontal, 18).padding(.bottom, 20) }
                    .scrollDismissesKeyboard(.interactively)
            }
            .frame(maxWidth: 560)
            .background(RoundedRectangle(cornerRadius: 30, style: .continuous).fill(.ultraThinMaterial))
            .background(RoundedRectangle(cornerRadius: 30, style: .continuous).fill(Color(red: 0.1, green: 0.1, blue: 0.11).opacity(0.78)))
            .overlay(RoundedRectangle(cornerRadius: 30, style: .continuous).stroke(Color.white.opacity(0.18), lineWidth: 1))
            .modifier(ChromaRim(on: !shown && !Glass.calm, strength: 1.4))
            .shadow(color: .black.opacity(0.45), radius: 30, y: 14)
            .padding(.horizontal, 12).padding(.vertical, 40)
            .scaleEffect(shown || Glass.calm ? 1 : 0.6)
            .opacity(shown ? 1 : 0)
        }
        .onAppear { withAnimation(.spring(response: 0.34, dampingFraction: 0.72)) { shown = true } }
    }

    private func dismiss() {
        withAnimation(.easeIn(duration: 0.16)) { shown = false }
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.17) { close() }
    }
}

// a switch row as the website's (.lm-row.sw-row)
struct SwitchRow: View {
    var title: String
    var sub: String? = nil
    @Binding var on: Bool
    var body: some View {
        Toggle(isOn: $on) {
            VStack(alignment: .leading, spacing: 2) {
                Text(title).font(.system(size: 15)).foregroundStyle(Theme.text)
                if let sub { Text(sub).font(.system(size: 12)).foregroundStyle(Theme.muted) }
            }
        }
        .tint(Theme.red)
        .onChange(of: on) { _ in Glass.tap(.soft) }
        .padding(.horizontal, 14).padding(.vertical, 10)
    }
}

// a box of rows, as the website's .lm-set
struct RowBox<Content: View>: View {
    @ViewBuilder var content: Content
    var body: some View {
        VStack(spacing: 0) { content }
            .background(RoundedRectangle(cornerRadius: 18, style: .continuous).fill(Color.black.opacity(0.22)))
            .overlay(RoundedRectangle(cornerRadius: 18, style: .continuous).stroke(Theme.edge))
    }
}

struct SectionHead: View {
    var text: String
    var body: some View {
        Text(text.uppercased()).font(.system(size: 12, weight: .semibold)).kerning(1.2).foregroundStyle(Theme.dim)
            .frame(maxWidth: .infinity, alignment: .leading).padding(.leading, 6).padding(.top, 6)
    }
}

struct ProBadge: View {
    var body: some View {
        Text("PRO").font(.system(size: 11, weight: .heavy)).kerning(1).foregroundStyle(.white)
            .padding(.horizontal, 8).padding(.vertical, 3)
            .background(Capsule().fill(LinearGradient(colors: [Theme.redHi, Theme.red], startPoint: .top, endPoint: .bottom)))
            .shadow(color: Theme.red.opacity(0.5), radius: 8, y: 3)
    }
}

// The pieces of RoarMe's pro camera (Alex, 21 Nov, from three screenshots of a pro camera: "these I want in the
// camera"): the dial with its marks, the grid, the focus mark, the level, the histogram and the settings panel.
// RoarCamera.swift puts them together.
import UIKit

/// RoarMe's look, handed over by the page (src/camera.js): the accent pair and its ink, Day or Night, Frost.
/// Alex, 21 Nov: "not exactly like the reference; by the theme we have".
struct CamTheme {
    var accent = UIColor(red: 0.11, green: 0.71, blue: 0.98, alpha: 1)
    var accentTop = UIColor(red: 0.35, green: 0.80, blue: 1, alpha: 1)
    var ink = UIColor.white
    var light = false
    var frost = false
    var bg: UIColor {
        if frost { return light ? UIColor(red: 0.85, green: 0.81, blue: 0.77, alpha: 1) : UIColor(red: 0.16, green: 0.14, blue: 0.12, alpha: 1) }
        return light ? UIColor(red: 0.95, green: 0.96, blue: 0.98, alpha: 1) : UIColor(red: 0.07, green: 0.07, blue: 0.08, alpha: 1)
    }
    var text: UIColor { frost && light ? UIColor(red: 0.23, green: 0.18, blue: 0.15, alpha: 1) : (light ? UIColor(white: 0.1, alpha: 1) : .white) }
    var soft: UIColor { text.withAlphaComponent(0.6) }
    var blur: UIBlurEffect.Style { light ? .systemThinMaterialLight : .systemThinMaterialDark }
    var rim: UIColor { UIColor(white: 1, alpha: light ? 0.7 : 0.14) }
}
var camTheme = CamTheme()
var roarBlue: UIColor { camTheme.accent }
var roarYellow: UIColor { camTheme.accent }

/// A view dressed in the theme's glass: a blur behind, a fine bright rim, round corners. Lit, it is the accent instead.
func glassify(_ v: UIView, radius: CGFloat) {
    v.backgroundColor = .clear
    v.layer.cornerRadius = radius
    v.layer.borderWidth = 0.6
    v.layer.borderColor = camTheme.rim.cgColor
    v.clipsToBounds = true
    if v.viewWithTag(4242) == nil {
        let e = UIVisualEffectView(effect: UIBlurEffect(style: camTheme.blur))
        e.tag = 4242
        e.isUserInteractionEnabled = false
        e.frame = v.bounds
        e.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        v.insertSubview(e, at: 0)
    }
}
/// Every glass layer fits its view and stays behind its sign and words (a button adds its image view later).
func fitGlass(_ root: UIView) {
    if let e = root.viewWithTag(4242), e.superview === root { e.frame = root.bounds; root.sendSubviewToBack(e) }
    for v in root.subviews where v.tag != 4242 { fitGlass(v) }
}
func glassLit(_ v: UIView, _ on: Bool) {
    v.viewWithTag(4242)?.isHidden = on
    v.backgroundColor = on ? camTheme.accent : .clear
    if let b = v as? UIButton { b.tintColor = on ? camTheme.ink : camTheme.text; b.setTitleColor(on ? camTheme.ink : camTheme.text, for: .normal) }
}

/// A dial dragged sideways, with marks and numbers, the value under the blue needle in the middle.
final class RulerDial: UIView {
    var values: [Float] = [] { didSet { setNeedsDisplay() } }
    var index: Int = 0 { didSet { setNeedsDisplay() } }
    var majorEvery: Int = 5
    var label: (Float) -> String = { String(format: "%.0f", $0) }
    var onChange: ((Int) -> Void)?
    private var startIndex = 0
    private let step: CGFloat = 9

    override init(frame: CGRect) {
        super.init(frame: frame)
        isOpaque = false
        backgroundColor = .clear
        contentMode = .redraw
        addGestureRecognizer(UIPanGestureRecognizer(target: self, action: #selector(pan(_:))))
    }
    required init?(coder: NSCoder) { fatalError() }

    @objc private func pan(_ g: UIPanGestureRecognizer) {
        if g.state == .began { startIndex = index }
        let dx = g.translation(in: self).x
        let n = max(0, min(values.count - 1, startIndex - Int((dx / step).rounded())))
        if n != index {
            index = n
            if n % majorEvery == 0 { UISelectionFeedbackGenerator().selectionChanged() }
            onChange?(n)
        }
    }

    override func draw(_ rect: CGRect) {
        guard let ctx = UIGraphicsGetCurrentContext(), !values.isEmpty else { return }
        let mid = bounds.midX
        let t = camTheme.text
        // the value itself, large in the accent, over the needle; the marks fade towards the edges
        let big: [NSAttributedString.Key: Any] = [.font: UIFont.monospacedDigitSystemFont(ofSize: 15, weight: .semibold), .foregroundColor: camTheme.accent]
        let cur = label(values[min(index, values.count - 1)]) as NSString
        let cw = cur.size(withAttributes: big).width
        cur.draw(at: CGPoint(x: mid - cw / 2, y: 2), withAttributes: big)
        let attrs: [NSAttributedString.Key: Any] = [.font: UIFont.monospacedDigitSystemFont(ofSize: 10, weight: .medium), .foregroundColor: t.withAlphaComponent(0.5)]
        let base: CGFloat = bounds.height - 6
        // numbers only where they have room: never on each other, never under the value
        var lastRight = -CGFloat.greatestFiniteMagnitude
        let keepOut = (mid - cw / 2 - 10)...(mid + cw / 2 + 10)
        for (i, v) in values.enumerated() {
            let x = mid + CGFloat(i - index) * step
            if x < -40 || x > bounds.width + 40 { continue }
            let major = i % majorEvery == 0
            let fade = max(0.15, 1 - abs(x - mid) / (bounds.width / 2))
            ctx.setStrokeColor(t.withAlphaComponent((major ? 0.7 : 0.3) * fade).cgColor)
            ctx.setLineWidth(major ? 1.4 : 1)
            ctx.setLineCap(.round)
            ctx.move(to: CGPoint(x: x, y: base))
            ctx.addLine(to: CGPoint(x: x, y: base - (major ? 12 : 7)))
            ctx.strokePath()
            if major {
                let s = label(v) as NSString
                let w = s.size(withAttributes: attrs).width
                let left = x - w / 2
                if left > lastRight + 10 && !(keepOut.contains(left) || keepOut.contains(left + w) || (left < keepOut.lowerBound && left + w > keepOut.upperBound)) {
                    s.draw(at: CGPoint(x: left, y: base - 26), withAttributes: attrs)
                    lastRight = left + w
                }
            }
        }
        // the needle: a short bar of the accent with a dot on it
        ctx.setStrokeColor(camTheme.accent.cgColor)
        ctx.setLineWidth(2.5)
        ctx.setLineCap(.round)
        ctx.move(to: CGPoint(x: mid, y: base))
        ctx.addLine(to: CGPoint(x: mid, y: base - 16))
        ctx.strokePath()
    }
}

/// The thirds, in fine white lines over the picture's frame.
final class GridView: UIView {
    override init(frame: CGRect) { super.init(frame: frame); isOpaque = false; isUserInteractionEnabled = false; contentMode = .redraw }
    required init?(coder: NSCoder) { fatalError() }
    override func draw(_ rect: CGRect) {
        guard let c = UIGraphicsGetCurrentContext() else { return }
        c.setStrokeColor(UIColor(white: 1, alpha: 0.45).cgColor)
        c.setLineWidth(0.7)
        for k in 1...2 {
            let x = bounds.width * CGFloat(k) / 3, y = bounds.height * CGFloat(k) / 3
            c.move(to: CGPoint(x: x, y: 0)); c.addLine(to: CGPoint(x: x, y: bounds.height))
            c.move(to: CGPoint(x: 0, y: y)); c.addLine(to: CGPoint(x: bounds.width, y: y))
        }
        c.strokePath()
        // corner marks of the frame
        c.setStrokeColor(UIColor(white: 1, alpha: 0.8).cgColor)
        c.setLineWidth(1.2)
        let m: CGFloat = 12
        let corners: [(CGFloat, CGFloat, CGFloat, CGFloat)] = [(0, 0, 1, 1), (bounds.width, 0, -1, 1), (0, bounds.height, 1, -1), (bounds.width, bounds.height, -1, -1)]
        for (x, y, dx, dy) in corners {
            c.move(to: CGPoint(x: x + dx * m, y: y)); c.addLine(to: CGPoint(x: x, y: y)); c.addLine(to: CGPoint(x: x, y: y + dy * m))
        }
        c.strokePath()
    }
}

/// The focus and exposure mark: four rounded corners of a square with a small dot in the middle, the accent while locked.
final class ReticleView: UIView {
    var locked = false { didSet { setNeedsDisplay() } }
    override init(frame: CGRect) { super.init(frame: frame); isOpaque = false; isUserInteractionEnabled = false }
    required init?(coder: NSCoder) { fatalError() }
    override func draw(_ rect: CGRect) {
        guard let c = UIGraphicsGetCurrentContext() else { return }
        let r = bounds.insetBy(dx: 30, dy: 30)
        let col = (locked ? camTheme.accent : UIColor.white).cgColor
        c.setStrokeColor(col)
        c.setLineWidth(2)
        c.setLineCap(.round)
        let k: CGFloat = 16, q: CGFloat = 10
        for (x, y, dx, dy) in [(r.minX, r.minY, CGFloat(1), CGFloat(1)), (r.maxX, r.minY, -1, 1), (r.minX, r.maxY, 1, -1), (r.maxX, r.maxY, -1, -1)] as [(CGFloat, CGFloat, CGFloat, CGFloat)] {
            c.move(to: CGPoint(x: x, y: y + dy * k))
            c.addLine(to: CGPoint(x: x, y: y + dy * q))
            c.addQuadCurve(to: CGPoint(x: x + dx * q, y: y), control: CGPoint(x: x, y: y))
            c.addLine(to: CGPoint(x: x + dx * k, y: y))
        }
        c.strokePath()
        c.setFillColor(col)
        c.fillEllipse(in: CGRect(x: bounds.midX - 2.5, y: bounds.midY - 2.5, width: 5, height: 5))
    }
}

/// The level: a line that turns with the phone and goes yellow when the phone is level.
final class LevelView: UIView {
    var angle: CGFloat = 0 { didSet { setNeedsDisplay() } }
    override init(frame: CGRect) { super.init(frame: frame); isOpaque = false; isUserInteractionEnabled = false }
    required init?(coder: NSCoder) { fatalError() }
    override func draw(_ rect: CGRect) {
        guard let c = UIGraphicsGetCurrentContext() else { return }
        let m = CGPoint(x: bounds.midX, y: bounds.midY)
        let level = abs(angle) < 0.017
        c.setStrokeColor((level ? roarYellow : UIColor(white: 1, alpha: 0.85)).cgColor)
        c.setLineWidth(level ? 2 : 1.4)
        c.move(to: CGPoint(x: m.x - 110, y: m.y)); c.addLine(to: CGPoint(x: m.x - 40, y: m.y))
        c.move(to: CGPoint(x: m.x + 40, y: m.y)); c.addLine(to: CGPoint(x: m.x + 110, y: m.y))
        c.strokePath()
        c.saveGState()
        c.translateBy(x: m.x, y: m.y)
        c.rotate(by: -angle)
        c.move(to: CGPoint(x: -36, y: 0)); c.addLine(to: CGPoint(x: 36, y: 0))
        c.strokePath()
        c.restoreGState()
    }
}

/// The histogram of the picture's light, as a soft filled shape.
final class HistView: UIView {
    var bins: [Float] = [] { didSet { setNeedsDisplay() } }
    override init(frame: CGRect) {
        super.init(frame: frame)
        isOpaque = false
        isUserInteractionEnabled = false
        backgroundColor = UIColor(white: 0, alpha: 0.35)
        layer.cornerRadius = 10
        clipsToBounds = true
    }
    required init?(coder: NSCoder) { fatalError() }
    override func draw(_ rect: CGRect) {
        guard let c = UIGraphicsGetCurrentContext(), bins.count > 1, let top = bins.max(), top > 0 else { return }
        let w = bounds.width, h = bounds.height - 6
        c.move(to: CGPoint(x: 0, y: bounds.height))
        for (i, v) in bins.enumerated() {
            c.addLine(to: CGPoint(x: w * CGFloat(i) / CGFloat(bins.count - 1), y: bounds.height - 3 - h * CGFloat(min(1, v / top))))
        }
        c.addLine(to: CGPoint(x: w, y: bounds.height))
        c.closePath()
        c.setFillColor(UIColor(white: 1, alpha: 0.75).cgColor)
        c.fillPath()
    }
}

/// One choice of the settings panel: a round with its sign or word, its name under it, blue while on.
final class ProTile: UIControl {
    let round = UIView()
    let icon = UIImageView()
    let word = UILabel()
    let name = UILabel()
    var lit = false { didSet { paint() } }

    init(title: String, symbol: String?, text: String?) {
        super.init(frame: .zero)
        round.isUserInteractionEnabled = false
        addSubview(round)
        icon.contentMode = .center
        icon.isUserInteractionEnabled = false
        if let s = symbol { icon.image = UIImage(systemName: s, withConfiguration: UIImage.SymbolConfiguration(pointSize: 24, weight: .regular)) }
        round.addSubview(icon)
        word.text = text
        word.font = .systemFont(ofSize: 22, weight: .medium)
        word.textAlignment = .center
        word.adjustsFontSizeToFitWidth = true
        word.minimumScaleFactor = 0.5
        round.addSubview(word)
        name.text = title
        name.font = .systemFont(ofSize: 12.5, weight: .regular)
        name.textAlignment = .center
        name.adjustsFontSizeToFitWidth = true
        name.minimumScaleFactor = 0.7
        addSubview(name)
        paint()
    }
    required init?(coder: NSCoder) { fatalError() }

    override func layoutSubviews() {
        super.layoutSubviews()
        let d = min(bounds.width, 64)
        round.frame = CGRect(x: (bounds.width - d) / 2, y: 0, width: d, height: d)
        glassify(round, radius: d * 0.32)
        round.viewWithTag(4242)?.frame = round.bounds
        icon.frame = round.bounds
        word.frame = round.bounds.insetBy(dx: 6, dy: 0)
        name.frame = CGRect(x: -6, y: d + 6, width: bounds.width + 12, height: 18)
    }

    private func paint() {
        glassLit(round, lit)
        let c = lit ? camTheme.ink : camTheme.text
        icon.tintColor = c
        word.textColor = c
        name.textColor = lit ? camTheme.text : camTheme.soft
    }

    override var isHighlighted: Bool { didSet { round.alpha = isHighlighted ? 0.6 : 1 } }
}

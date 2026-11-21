// The pieces of RoarMe's pro camera (Alex, 21 Nov, from three screenshots of a pro camera: "these I want in the
// camera"): the dial with its marks, the grid, the focus mark, the level, the histogram and the settings panel.
// RoarCamera.swift puts them together.
import UIKit

let roarBlue = UIColor(red: 0.36, green: 0.66, blue: 1, alpha: 1)
let roarYellow = UIColor(red: 1, green: 0.84, blue: 0.04, alpha: 1)

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
        backgroundColor = UIColor(white: 0.13, alpha: 1)
        layer.cornerRadius = 22
        clipsToBounds = true
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
        let attrs: [NSAttributedString.Key: Any] = [.font: UIFont.monospacedDigitSystemFont(ofSize: 11, weight: .medium), .foregroundColor: UIColor(white: 1, alpha: 0.6)]
        for (i, v) in values.enumerated() {
            let x = mid + CGFloat(i - index) * step
            if x < -20 || x > bounds.width + 20 { continue }
            let major = i % majorEvery == 0
            ctx.setStrokeColor(UIColor(white: 1, alpha: major ? 0.75 : 0.35).cgColor)
            ctx.setLineWidth(major ? 1.5 : 1)
            ctx.move(to: CGPoint(x: x, y: 8))
            ctx.addLine(to: CGPoint(x: x, y: major ? 24 : 18))
            ctx.strokePath()
            if major {
                let s = label(v) as NSString
                let w = s.size(withAttributes: attrs).width
                s.draw(at: CGPoint(x: x - w / 2, y: 26), withAttributes: attrs)
            }
        }
        // the needle
        ctx.setFillColor(roarBlue.cgColor)
        ctx.move(to: CGPoint(x: mid - 5, y: 4))
        ctx.addLine(to: CGPoint(x: mid + 5, y: 4))
        ctx.addLine(to: CGPoint(x: mid, y: 13))
        ctx.closePath()
        ctx.fillPath()
        ctx.setStrokeColor(roarBlue.cgColor)
        ctx.setLineWidth(2)
        ctx.move(to: CGPoint(x: mid, y: 10))
        ctx.addLine(to: CGPoint(x: mid, y: 26))
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

/// The focus and exposure mark: a soft round with a cross through it, yellow while locked.
final class ReticleView: UIView {
    var locked = false { didSet { setNeedsDisplay() } }
    override init(frame: CGRect) { super.init(frame: frame); isOpaque = false; isUserInteractionEnabled = false }
    required init?(coder: NSCoder) { fatalError() }
    override func draw(_ rect: CGRect) {
        guard let c = UIGraphicsGetCurrentContext() else { return }
        let m = CGPoint(x: bounds.midX, y: bounds.midY)
        c.setFillColor(UIColor(white: 0, alpha: 0.35).cgColor)
        c.fillEllipse(in: CGRect(x: m.x - 26, y: m.y - 26, width: 52, height: 52))
        c.setStrokeColor((locked ? roarYellow : .white).cgColor)
        c.setLineWidth(1.2)
        c.move(to: CGPoint(x: m.x - 60, y: m.y)); c.addLine(to: CGPoint(x: m.x + 60, y: m.y))
        c.move(to: CGPoint(x: m.x, y: m.y - 60)); c.addLine(to: CGPoint(x: m.x, y: m.y + 60))
        for t in [-30.0, 30.0] {
            c.move(to: CGPoint(x: m.x + CGFloat(t), y: m.y - 5)); c.addLine(to: CGPoint(x: m.x + CGFloat(t), y: m.y + 5))
            c.move(to: CGPoint(x: m.x - 5, y: m.y + CGFloat(t))); c.addLine(to: CGPoint(x: m.x + 5, y: m.y + CGFloat(t)))
        }
        c.strokePath()
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
        round.backgroundColor = UIColor(white: 1, alpha: 0.1)
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
        round.layer.cornerRadius = d / 2
        icon.frame = round.bounds
        word.frame = round.bounds.insetBy(dx: 6, dy: 0)
        name.frame = CGRect(x: -6, y: d + 6, width: bounds.width + 12, height: 18)
    }

    private func paint() {
        let c = lit ? roarBlue : UIColor.white
        icon.tintColor = c
        word.textColor = c
        name.textColor = lit ? roarBlue : UIColor(white: 1, alpha: 0.85)
    }

    override var isHighlighted: Bool { didSet { round.alpha = isHighlighted ? 0.6 : 1 } }
}

// RoarMe's own camera inside the iPhone app (Alex, 21 Nov: VIDEO · PHOTO · DUAL; then, from three screenshots of a pro
// camera: "these I want in the camera"). A full-screen native screen, in PHOTO a pro camera:
//  - top: X, the lens's aperture and what comes out (12 / 48 MP, JPEG / HEIF / RAW); flash, shutter speed, EV, ISO, flip
//  - the picture: its whole frame with corner marks, the thirds, the focus mark (tap to focus, hold to lock), lenses
//    .5 / 1 / 2-5x, the level, the histogram, the black bars of another aspect, the anamorphic stretch, black and white
//  - a dial under it with marks for what is chosen: EV, shutter, ISO, focus or white balance
//  - foot: the newest photo (to the Gallery), a capsule with the mode (photo, video, dual), the shutter (hold for rapid
//    fire) and the self-timer, and the panel button; under them HDR, 12M / 48M, and SI (auto) · WB · MF
//  - the panel, two pages: Rapid Fire, F/E Lock, Grids, Tiltmeter, Semi-Auto, Histogram, Aspect Ratio, Format,
//    2nd Shutter; Orientation, Mirroring, Anamorphic, RAW, Black & White
// VIDEO keeps the torch and the time (at most 3 minutes); DUAL makes one photo of both cameras. The plugin answers the
// page (src/camera.js) with the files it made, which the page opens in its editor (RAW goes as a file). Added to the app
// by .github/workflows/ios.yml with RoarCameraPro.swift and RoarViewController.swift, which registers it.
import UIKit
import AVFoundation
import Photos
import CoreMotion
import CoreImage
import Capacitor

@objc(RoarCameraPlugin)
public class RoarCameraPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "RoarCameraPlugin"
    public let jsName = "RoarCamera"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "available", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "open", returnType: CAPPluginReturnPromise),
    ]

    @objc func available(_ call: CAPPluginCall) {
        call.resolve(["ok": true, "dual": AVCaptureMultiCamSession.isMultiCamSupported, "pro": true])
    }

    static func color(_ hex: String?) -> UIColor? {
        guard var h = hex?.trimmingCharacters(in: .whitespaces), h.hasPrefix("#") else { return nil }
        h.removeFirst()
        guard h.count == 6, let v = UInt32(h, radix: 16) else { return nil }
        return UIColor(red: CGFloat((v >> 16) & 255) / 255, green: CGFloat((v >> 8) & 255) / 255, blue: CGFloat(v & 255) / 255, alpha: 1)
    }

    @objc func open(_ call: CAPPluginCall) {
        let only = call.getString("only") ?? ""
        var th = CamTheme()
        if let c = RoarCameraPlugin.color(call.getString("accent")) { th.accent = c }
        if let c = RoarCameraPlugin.color(call.getString("accentTop")) { th.accentTop = c }
        if let c = RoarCameraPlugin.color(call.getString("ink")) { th.ink = c }
        th.light = call.getBool("light") ?? false
        th.frost = call.getBool("frost") ?? false
        camTheme = th
        DispatchQueue.main.async {
            guard let host = self.bridge?.viewController else { call.reject("No screen to show the camera on"); return }
            let vc = RoarCameraController()
            vc.only = only
            vc.modalPresentationStyle = .fullScreen
            vc.done = { result in call.resolve(result) }
            host.present(vc, animated: true)
        }
    }
}

final class RoarCameraController: UIViewController, AVCapturePhotoCaptureDelegate, AVCaptureFileOutputRecordingDelegate, AVCaptureVideoDataOutputSampleBufferDelegate, UIScrollViewDelegate {
    enum Mode: Int { case video = 0, photo = 1, dual = 2 }
    enum Param { case ev, shutter, iso, focus, wb }
    enum Format: Int { case jpeg = 0, heif = 1, raw = 2 }

    var only = ""
    var done: (([String: Any]) -> Void)?

    // ---- state ----
    private var mode: Mode = .photo
    private var front = false
    private var flash: AVCaptureDevice.FlashMode = .off
    private var torchOn = false
    private let queue = DispatchQueue(label: "roarme.camera")
    private let frameQueue = DispatchQueue(label: "roarme.camera.frames")
    private var session: AVCaptureSession?
    private var photoOut: AVCapturePhotoOutput?
    private var frontOut: AVCapturePhotoOutput?
    private var movieOut: AVCaptureMovieFileOutput?
    private var device: AVCaptureDevice?
    private var dualParts: [Bool: UIImage] = [:]
    private var finished = false
    private var recordStart: Date?
    private var ticker: Timer?
    private var readTimer: Timer?

    // pro
    private var param: Param = .ev
    private var manualExposure = false
    private var ev: Float = 0
    private var shutterIndex = 0
    private var isoIndex = 0
    private var focusManual = false
    private var focusIndex = 50
    private var wbManual = false
    private var wbIndex = 30
    private var grid = false
    private var histOn = false
    private var levelOn = false
    private var aspect = 0 // 0 4:3, 1 16:9, 2 1:1
    private var format: Format = .jpeg
    private var hdr = true
    private var big48 = false
    private var rapid = false
    private var feLock = false
    private var timerSecs = 0
    private var mirror = true
    private var anamorphic = false
    private var bw = false
    private var orientLock = false
    private var rollAngle: CGFloat = 0
    private var shotAngle: CGFloat = 90
    // the back lenses as the real cameras they are (a virtual camera takes no manual exposure, focus or white balance,
    // and no 48 MP): label, camera, zoom on it
    private var lensFactors: [(String, AVCaptureDevice, CGFloat)] = []
    private var lensIndex = -1
    private var rotCoord: AnyObject?
    private var rotObs: NSKeyValueObservation?
    private var dualCoords: [AnyObject] = []
    private var frameCount = 0
    private var shots: [String] = []
    private var pending = 0
    private var burst: Timer?
    private var counting = false
    private let motion = CMMotionManager()
    private let ci = CIContext()

    private let shutters: [Double] = [1.0 / 8000, 1.0 / 4000, 1.0 / 2000, 1.0 / 1000, 1.0 / 500, 1.0 / 250, 1.0 / 125, 1.0 / 60, 1.0 / 30, 1.0 / 15, 1.0 / 8, 1.0 / 4, 1.0 / 2]
    private let isos: [Float] = [25, 32, 40, 50, 64, 80, 100, 125, 160, 200, 250, 320, 400, 500, 640, 800, 1000, 1250, 1600, 2000, 2500, 3200, 4000, 5000, 6400, 8000, 10000, 12800]
    private var shutterList: [Double] = []
    private var isoList: [Float] = []
    private let evList: [Float] = (-20...20).map { Float($0) / 10 }
    private let focusList: [Float] = (0...100).map { Float($0) / 100 }
    private let wbList: [Float] = (25...85).map { Float($0 * 100) }

    // ---- views ----
    private let card = UIView()
    private let preview = UIView()
    private let pip = UIView()
    private var previewLayer: AVCaptureVideoPreviewLayer?
    private var pipLayer: AVCaptureVideoPreviewLayer?
    private let frameView = UIView()
    private let gridView = GridView()
    private let reticle = ReticleView(frame: CGRect(x: 0, y: 0, width: 130, height: 130))
    private let levelView = LevelView()
    private let histView = HistView()
    private let bwView = UIView()
    private let maskA = UIView()
    private let maskB = UIView()
    private let lensBar = UIView()
    private var lensButtons: [UIButton] = []
    private let closeBtn = UIButton(type: .system)
    private let infoLeft = UILabel()
    private let infoRight = UILabel()
    private let flashBtn = UIButton(type: .system)
    private let flipBtn = UIButton(type: .system)
    private let shutterPill = UIButton(type: .system)
    private let evPill = UIButton(type: .system)
    private let isoPill = UIButton(type: .system)
    private let dial = RulerDial()
    private let dialBox = UIView()
    private let expoBar = UIView()
    private let capsule = UIView()
    private let modeBtn = UIButton(type: .system)
    private let shutter = UIButton(type: .custom)
    private let shutterInner = UIView()
    private let shutterIcon = UIImageView()
    private let timerBtn = UIButton(type: .system)
    private let galleryBtn = UIButton(type: .custom)
    private let menuBtn = UIButton(type: .system)
    private let hdrBtn = UIButton(type: .system)
    private let mpBtn = UIButton(type: .system)
    private let seg = UIView()
    private let siBtn = UIButton(type: .system)
    private let wbBtn = UIButton(type: .system)
    private let mfBtn = UIButton(type: .system)
    private let timeLabel = UILabel()
    private let countLabel = UILabel()
    private let toast = UILabel()
    private let white = UIView()
    private let sheetBack = UIControl()
    private let sheet = UIView()
    private let pages = UIScrollView()
    private let dots = UIPageControl()
    private var tiles: [String: ProTile] = [:]

    deinit { NotificationCenter.default.removeObserver(self) }

    override var preferredStatusBarStyle: UIStatusBarStyle { camTheme.light ? .darkContent : .lightContent }
    override var supportedInterfaceOrientations: UIInterfaceOrientationMask { .portrait }

    private var modes: [Mode] {
        if only == "photo" { return [.photo] }
        return AVCaptureMultiCamSession.isMultiCamSupported ? [.photo, .video, .dual] : [.photo, .video]
    }
    private var pro: Bool { mode == .photo }

    // ---- building the screen ----
    // shutter, EV and ISO are three parts of one glass capsule; the chosen one is a pill of the accent inside it
    private func pill(_ b: UIButton, _ title: String) {
        b.setTitle(title, for: .normal)
        b.titleLabel?.font = .monospacedDigitSystemFont(ofSize: 13.5, weight: .semibold)
        b.titleLabel?.adjustsFontSizeToFitWidth = true
        b.titleLabel?.minimumScaleFactor = 0.7
        b.setTitleColor(camTheme.text, for: .normal)
        b.layer.cornerRadius = 15
        expoBar.addSubview(b)
    }

    private func roundBtn(_ b: UIButton, _ symbol: String, size: CGFloat = 20) {
        b.setImage(UIImage(systemName: symbol, withConfiguration: UIImage.SymbolConfiguration(pointSize: size, weight: .medium)), for: .normal)
        glassify(b, radius: 22)
        b.tintColor = camTheme.text
    }

    // a choice inside a glass bar: lit, a pill of the accent with its ink
    private func inner(_ b: UIButton, _ on: Bool, manual: Bool = false) {
        b.backgroundColor = on ? camTheme.accent : .clear
        let c = on ? camTheme.ink : (manual ? camTheme.accent : camTheme.text)
        b.tintColor = c
        b.setTitleColor(c, for: .normal)
    }

    override func viewDidLoad() {
        super.viewDidLoad()
        overrideUserInterfaceStyle = camTheme.light ? .light : .dark
        view.backgroundColor = camTheme.bg
        glassify(expoBar, radius: 20)
        view.addSubview(expoBar)
        glassify(dialBox, radius: 23)
        view.addSubview(dialBox)

        // top
        roundBtn(closeBtn, "xmark", size: 15)
        closeBtn.addTarget(self, action: #selector(close), for: .touchUpInside)
        view.addSubview(closeBtn)
        for l in [infoLeft, infoRight] {
            l.textColor = camTheme.soft
            l.font = .systemFont(ofSize: 13, weight: .medium)
            l.numberOfLines = 2
            view.addSubview(l)
        }
        infoRight.textAlignment = .right
        roundBtn(flashBtn, "bolt.slash.fill")
        flashBtn.addTarget(self, action: #selector(toggleFlash), for: .touchUpInside)
        view.addSubview(flashBtn)
        roundBtn(flipBtn, "arrow.triangle.2.circlepath", size: 19)
        flipBtn.addTarget(self, action: #selector(flip), for: .touchUpInside)
        view.addSubview(flipBtn)
        pill(shutterPill, "1/60 s")
        pill(evPill, "+0.0 EV")
        pill(isoPill, "ISO 100")
        shutterPill.addTarget(self, action: #selector(pickShutter), for: .touchUpInside)
        evPill.addTarget(self, action: #selector(pickEV), for: .touchUpInside)
        isoPill.addTarget(self, action: #selector(pickISO), for: .touchUpInside)

        // the picture
        card.backgroundColor = .black
        card.layer.cornerRadius = 28
        card.layer.cornerCurve = .continuous
        card.clipsToBounds = true
        view.addSubview(card)
        preview.backgroundColor = .black
        card.addSubview(preview)
        bwView.backgroundColor = .gray
        bwView.layer.compositingFilter = "saturationBlendMode"
        bwView.isUserInteractionEnabled = false
        bwView.isHidden = true
        card.addSubview(bwView)
        frameView.isUserInteractionEnabled = false
        card.addSubview(frameView)
        for m in [maskA, maskB] { m.backgroundColor = UIColor(white: 0, alpha: 0.62); m.isUserInteractionEnabled = false; frameView.addSubview(m) }
        frameView.addSubview(gridView)
        levelView.isHidden = true
        card.addSubview(levelView)
        histView.isHidden = true
        card.addSubview(histView)
        reticle.alpha = 0
        card.addSubview(reticle)
        pip.backgroundColor = .black
        pip.layer.cornerRadius = 18
        pip.clipsToBounds = true
        pip.isHidden = true
        card.addSubview(pip)
        lensBar.backgroundColor = UIColor(white: 0, alpha: 0.32)
        lensBar.layer.cornerRadius = 26
        lensBar.layer.borderWidth = 0.6
        lensBar.layer.borderColor = UIColor(white: 1, alpha: 0.18).cgColor
        card.addSubview(lensBar)
        timeLabel.font = .monospacedDigitSystemFont(ofSize: 15, weight: .semibold)
        timeLabel.textColor = .white
        timeLabel.textAlignment = .center
        timeLabel.backgroundColor = UIColor(red: 1, green: 0.23, blue: 0.19, alpha: 1)
        timeLabel.layer.cornerRadius = 13
        timeLabel.clipsToBounds = true
        timeLabel.isHidden = true
        card.addSubview(timeLabel)
        countLabel.font = .monospacedDigitSystemFont(ofSize: 120, weight: .thin)
        countLabel.textColor = .white
        countLabel.textAlignment = .center
        countLabel.isHidden = true
        card.addSubview(countLabel)
        toast.font = .systemFont(ofSize: 13, weight: .semibold)
        toast.textColor = .white
        toast.textAlignment = .center
        toast.backgroundColor = UIColor(white: 0, alpha: 0.55)
        toast.layer.cornerRadius = 14
        toast.clipsToBounds = true
        toast.alpha = 0
        card.addSubview(toast)

        let tap = UITapGestureRecognizer(target: self, action: #selector(focusTap(_:)))
        preview.addGestureRecognizer(tap)
        let holdFocus = UILongPressGestureRecognizer(target: self, action: #selector(focusHold(_:)))
        holdFocus.minimumPressDuration = 0.6
        preview.addGestureRecognizer(holdFocus)
        preview.addGestureRecognizer(UIPinchGestureRecognizer(target: self, action: #selector(pinched(_:))))
        let left = UISwipeGestureRecognizer(target: self, action: #selector(swiped(_:)))
        left.direction = .left
        let right = UISwipeGestureRecognizer(target: self, action: #selector(swiped(_:)))
        right.direction = .right
        card.addGestureRecognizer(left)
        card.addGestureRecognizer(right)

        // the dial
        dialBox.addSubview(dial)
        dial.onChange = { [weak self] i in self?.dialMoved(i) }

        // foot
        capsule.backgroundColor = .clear
        view.addSubview(capsule)
        glassify(modeBtn, radius: 24)
        modeBtn.tintColor = camTheme.text
        modeBtn.addTarget(self, action: #selector(nextMode), for: .touchUpInside)
        capsule.addSubview(modeBtn)
        shutter.backgroundColor = .clear
        shutter.layer.borderColor = camTheme.accent.cgColor
        shutter.layer.borderWidth = 3.5
        shutter.layer.cornerRadius = 40
        shutter.addTarget(self, action: #selector(shoot), for: .touchUpInside)
        let hold = UILongPressGestureRecognizer(target: self, action: #selector(shutterHold(_:)))
        hold.minimumPressDuration = 0.35
        shutter.addGestureRecognizer(hold)
        view.addSubview(shutter)
        shutterInner.isUserInteractionEnabled = false
        shutterInner.backgroundColor = .white
        shutter.addSubview(shutterInner)
        shutterIcon.contentMode = .center
        shutterIcon.isUserInteractionEnabled = false
        shutter.addSubview(shutterIcon)
        glassify(timerBtn, radius: 24)
        timerBtn.tintColor = camTheme.text
        timerBtn.titleLabel?.font = .systemFont(ofSize: 14, weight: .bold)
        timerBtn.addTarget(self, action: #selector(cycleTimer), for: .touchUpInside)
        capsule.addSubview(timerBtn)
        glassify(galleryBtn, radius: 18)
        galleryBtn.layer.cornerCurve = .continuous
        galleryBtn.tintColor = camTheme.text
        galleryBtn.setImage(UIImage(systemName: "photo.on.rectangle", withConfiguration: UIImage.SymbolConfiguration(pointSize: 20, weight: .semibold)), for: .normal)
        galleryBtn.imageView?.contentMode = .scaleAspectFill
        galleryBtn.addTarget(self, action: #selector(gallery), for: .touchUpInside)
        galleryBtn.isHidden = only == "photo"
        view.addSubview(galleryBtn)
        roundBtn(menuBtn, "slider.horizontal.3", size: 19)
        menuBtn.layer.cornerRadius = 18
        menuBtn.layer.cornerCurve = .continuous
        menuBtn.addTarget(self, action: #selector(openSheet), for: .touchUpInside)
        view.addSubview(menuBtn)
        // one glass bar at the foot: HDR and 12M / 48M, a fine line, then AUTO · WB · MF
        glassify(seg, radius: 22)
        view.addSubview(seg)
        let line = UIView()
        line.tag = 77
        line.backgroundColor = camTheme.text.withAlphaComponent(0.18)
        seg.addSubview(line)
        for (b, t) in [(hdrBtn, "HDR"), (mpBtn, "12M"), (siBtn, "AUTO"), (wbBtn, "WB"), (mfBtn, "MF")] {
            b.setTitle(t, for: .normal)
            b.titleLabel?.font = .systemFont(ofSize: 13.5, weight: .semibold)
            b.layer.cornerRadius = 17
            seg.addSubview(b)
        }
        hdrBtn.addTarget(self, action: #selector(toggleHDR), for: .touchUpInside)
        mpBtn.addTarget(self, action: #selector(toggle48), for: .touchUpInside)
        siBtn.addTarget(self, action: #selector(pickSI), for: .touchUpInside)
        wbBtn.addTarget(self, action: #selector(pickWB), for: .touchUpInside)
        mfBtn.addTarget(self, action: #selector(pickMF), for: .touchUpInside)

        white.backgroundColor = .white
        white.alpha = 0
        white.isUserInteractionEnabled = false
        view.addSubview(white)
        buildSheet()

        refreshUI()
        loadGalleryThumb()
        startMotion()
        readTimer = Timer.scheduledTimer(withTimeInterval: 0.3, repeats: true) { [weak self] _ in self?.readCamera() }
        AVCaptureDevice.requestAccess(for: .video) { ok in
            DispatchQueue.main.async { if ok { self.configure() } else { self.finish(["error": "camera"]) } }
        }
    }

    private func buildSheet() {
        sheetBack.backgroundColor = UIColor(white: 0, alpha: 0.35)
        sheetBack.alpha = 0
        sheetBack.isHidden = true
        sheetBack.addTarget(self, action: #selector(closeSheet), for: .touchUpInside)
        view.addSubview(sheetBack)
        glassify(sheet, radius: 34)
        sheet.layer.cornerCurve = .continuous
        sheet.isHidden = true
        view.addSubview(sheet)
        let grab = UIView(frame: CGRect(x: 0, y: 0, width: 40, height: 5))
        grab.backgroundColor = camTheme.text.withAlphaComponent(0.3)
        grab.layer.cornerRadius = 2.5
        grab.tag = 9
        sheet.addSubview(grab)
        let down = UISwipeGestureRecognizer(target: self, action: #selector(closeSheet))
        down.direction = .down
        sheet.addGestureRecognizer(down)
        pages.isPagingEnabled = true
        pages.showsHorizontalScrollIndicator = false
        pages.delegate = self
        sheet.addSubview(pages)
        dots.numberOfPages = 2
        dots.isUserInteractionEnabled = false
        dots.currentPageIndicatorTintColor = camTheme.accent
        dots.pageIndicatorTintColor = camTheme.text.withAlphaComponent(0.25)
        sheet.addSubview(dots)
        let list: [(String, String, String?, String?)] = [
            ("rapid", "Rapid Fire", "square.stack.3d.down.right", nil), ("fe", "F/E Lock", "lock", nil),
            ("grid", "Grids", "number", nil), ("level", "Tiltmeter", "level", nil),
            ("si", "Semi-Auto", nil, "SI"), ("hist", "Histogram", "chart.bar.xaxis", nil),
            ("aspect", "Aspect Ratio", nil, "4:3"), ("format", "Format", nil, "JPG"),
            ("orient", "Orientation", "lock.rotation", nil), ("mirror", "Mirroring", "arrow.left.and.right.righttriangle.left.righttriangle.right", nil),
            ("anam", "Anamorphic", nil, "1.33x"), ("raw", "RAW", nil, "RAW"), ("bw", "Black & White", nil, "BW"),
        ]
        for (key, title, sym, text) in list {
            let t = ProTile(title: title, symbol: sym, text: text)
            t.accessibilityIdentifier = key
            t.addTarget(self, action: #selector(tileTapped(_:)), for: .touchUpInside)
            pages.addSubview(t)
            tiles[key] = t
        }
    }

    // ---- layout ----
    override func viewDidLayoutSubviews() {
        super.viewDidLayoutSubviews()
        let s = view.safeAreaInsets, w = view.bounds.width, h = view.bounds.height
        var y = s.top + 4
        closeBtn.frame = CGRect(x: 16, y: y, width: 34, height: 34)
        closeBtn.layer.cornerRadius = 17
        infoLeft.frame = CGRect(x: 60, y: y, width: w / 2 - 60, height: 34)
        infoRight.frame = CGRect(x: w / 2, y: y - 4, width: w / 2 - 18, height: 42)
        y += 42
        let r: CGFloat = 44
        flashBtn.frame = CGRect(x: 16, y: y, width: r, height: r)
        flipBtn.frame = CGRect(x: w - 16 - r, y: y, width: r, height: r)
        for b in [flashBtn, flipBtn] { b.layer.cornerRadius = r / 2 }
        expoBar.frame = CGRect(x: 16 + r + 10, y: y + 2, width: w - 32 - 2 * r - 20, height: 40)
        let pw = (expoBar.bounds.width - 10) / 3
        for (i, b) in [shutterPill, evPill, isoPill].enumerated() {
            b.frame = CGRect(x: 5 + CGFloat(i) * pw, y: 5, width: pw, height: 30)
        }
        y += r + 10
        let footH: CGFloat = pro ? 46 + 10 + 92 + 10 + 44 : 92 + 10 + 44
        let cardH = max(260, h - y - s.bottom - footH - 12)
        card.frame = CGRect(x: 10, y: y, width: w - 20, height: cardH)
        preview.frame = card.bounds
        previewLayer?.frame = preview.bounds
        bwView.frame = card.bounds
        layoutFrame()
        levelView.frame = card.bounds
        histView.frame = CGRect(x: 12, y: 12, width: 118, height: 60)
        let cwid = card.bounds.width
        let pwp = round(cwid * 0.3), php = round(pwp * 16 / 9 * 0.92)
        pip.frame = CGRect(x: cwid - pwp - 18, y: 18, width: pwp, height: php)
        pipLayer?.frame = pip.bounds
        layoutLenses()
        timeLabel.frame = CGRect(x: (cwid - 78) / 2, y: 12, width: 78, height: 26)
        countLabel.frame = card.bounds
        toast.frame = CGRect(x: (cwid - 140) / 2, y: 14, width: 140, height: 28)
        y += cardH + 10
        dialBox.frame = CGRect(x: 16, y: y, width: w - 32, height: 46)
        dial.frame = dialBox.bounds.insetBy(dx: 14, dy: 0)
        dialBox.isHidden = !pro
        if pro { y += 46 + 10 }
        // the foot: the newest photo and the panel at the edges, mode · shutter · timer in the middle, no capsule
        capsule.frame = CGRect(x: 0, y: y, width: w, height: 92)
        shutter.frame = CGRect(x: (w - 80) / 2, y: y + 6, width: 80, height: 80)
        layoutShutter()
        modeBtn.frame = CGRect(x: w / 2 - 40 - 22 - 48, y: 22, width: 48, height: 48)
        timerBtn.frame = CGRect(x: w / 2 + 40 + 22, y: 22, width: 48, height: 48)
        galleryBtn.frame = CGRect(x: 18, y: y + 20, width: 52, height: 52)
        menuBtn.frame = CGRect(x: w - 18 - 52, y: y + 20, width: 52, height: 52)
        y += 92 + 10
        seg.frame = CGRect(x: 16, y: y, width: w - 32, height: 44)
        let sw = (seg.bounds.width - 18) / 5
        for (i, b) in [hdrBtn, mpBtn, siBtn, wbBtn, mfBtn].enumerated() {
            b.frame = CGRect(x: 5 + CGFloat(i) * sw + (i >= 2 ? 8 : 0), y: 5, width: sw, height: 34)
        }
        seg.viewWithTag(77)?.frame = CGRect(x: 5 + 2 * sw + 3.5, y: 12, width: 1, height: 20)
        seg.isHidden = !pro
        white.frame = view.bounds
        sheetBack.frame = view.bounds
        let sh: CGFloat = 400 + s.bottom
        sheet.frame = CGRect(x: 10, y: h - sh - 4, width: w - 20, height: sh)
        sheet.viewWithTag(9)?.frame = CGRect(x: (sheet.bounds.width - 40) / 2, y: 10, width: 40, height: 5)
        pages.frame = CGRect(x: 0, y: 34, width: sheet.bounds.width, height: 330)
        pages.contentSize = CGSize(width: pages.bounds.width * 2, height: 330)
        dots.frame = CGRect(x: 0, y: 364, width: sheet.bounds.width, height: 20)
        let order = ["rapid", "fe", "grid", "level", "si", "hist", "aspect", "format", "orient", "mirror", "anam", "raw", "bw"]
        let tw = (pages.bounds.width - 40) / 4
        for (i, key) in order.enumerated() {
            let page = i < 8 ? 0 : 1, k = i < 8 ? i : i - 8
            tiles[key]?.frame = CGRect(x: CGFloat(page) * pages.bounds.width + 20 + CGFloat(k % 4) * tw + 4, y: 8 + CGFloat(k / 4) * 104, width: tw - 8, height: 90)
        }
        fitGlass(view)
    }

    // the photo's own frame inside the card (the whole 3:4 picture, as it will be), with the bars of another aspect
    private func pictureRect() -> CGRect {
        guard pro else { return card.bounds }
        let b = card.bounds
        let ratio: CGFloat = 3.0 / 4.0
        var wv = b.width, hv = b.width / ratio
        if hv > b.height { hv = b.height; wv = hv * ratio }
        return CGRect(x: (b.width - wv) / 2, y: (b.height - hv) / 2, width: wv, height: hv)
    }

    private func layoutFrame() {
        let f = pictureRect()
        frameView.frame = f
        gridView.frame = frameView.bounds
        gridView.isHidden = !(grid && pro)
        gridView.setNeedsDisplay()
        let fw = f.width, fh = f.height
        if aspect == 1 {
            let hw = fh * 9 / 16
            let side = (fw - hw) / 2
            maskA.frame = CGRect(x: 0, y: 0, width: max(0, side), height: fh)
            maskB.frame = CGRect(x: fw - max(0, side), y: 0, width: max(0, side), height: fh)
        } else if aspect == 2 {
            let side = (fh - fw) / 2
            maskA.frame = CGRect(x: 0, y: 0, width: fw, height: max(0, side))
            maskB.frame = CGRect(x: 0, y: fh - max(0, side), width: fw, height: max(0, side))
        } else {
            maskA.frame = .zero
            maskB.frame = .zero
        }
        maskA.isHidden = !pro
        maskB.isHidden = !pro
    }

    private func layoutLenses() {
        let n = lensButtons.count
        let bw: CGFloat = 44, gap: CGFloat = 6
        let lw = CGFloat(n) * bw + CGFloat(max(0, n - 1)) * gap + 8
        lensBar.frame = CGRect(x: (card.bounds.width - lw) / 2, y: card.bounds.height - 64, width: lw, height: 52)
        for (i, b) in lensButtons.enumerated() { b.frame = CGRect(x: 4 + CGFloat(i) * (bw + gap), y: 4, width: bw, height: bw) }
        lensBar.isHidden = n < 2 || mode == .dual
    }

    private func layoutShutter() {
        let b = shutter.bounds
        let recording = movieOut?.isRecording == true
        shutterIcon.frame = b
        if mode == .video {
            if recording {
                shutterInner.frame = CGRect(x: b.midX - 15, y: b.midY - 15, width: 30, height: 30)
                shutterInner.layer.cornerRadius = 7
            } else {
                shutterInner.frame = b.insetBy(dx: 9, dy: 9)
                shutterInner.layer.cornerRadius = shutterInner.frame.width / 2
            }
            shutterInner.backgroundColor = UIColor(red: 1, green: 0.23, blue: 0.19, alpha: 1)
            shutterIcon.image = nil
        } else {
            shutterInner.frame = b.insetBy(dx: 9, dy: 9)
            shutterInner.layer.cornerRadius = shutterInner.frame.width / 2
            shutterInner.backgroundColor = .white
            shutterIcon.image = mode == .dual ? UIImage(systemName: "camera.fill", withConfiguration: UIImage.SymbolConfiguration(pointSize: 24, weight: .semibold)) : nil
            shutterIcon.tintColor = UIColor(red: 0.04, green: 0.52, blue: 1, alpha: 1)
        }
    }

    // ---- what the screen shows ----
    private func refreshUI() {
        let cfg = UIImage.SymbolConfiguration(pointSize: 19, weight: .semibold)
        let name: String
        if mode == .video { name = torchOn ? "flashlight.on.fill" : "flashlight.off.fill" }
        else { name = flash == .on ? "bolt.fill" : flash == .auto ? "bolt.badge.a.fill" : "bolt.slash.fill" }
        flashBtn.setImage(UIImage(systemName: name, withConfiguration: cfg), for: .normal)
        glassLit(flashBtn, mode == .video ? torchOn : flash != .off)
        flashBtn.isHidden = mode == .dual
        flipBtn.isHidden = mode == .dual
        expoBar.isHidden = !pro
        pip.isHidden = mode != .dual
        let modeSym = mode == .photo ? "camera" : mode == .video ? "video" : "rectangle.on.rectangle"
        modeBtn.setImage(UIImage(systemName: modeSym, withConfiguration: UIImage.SymbolConfiguration(pointSize: 21, weight: .regular)), for: .normal)
        modeBtn.isHidden = modes.count < 2
        timerBtn.setImage(timerSecs == 0 ? UIImage(systemName: "timer", withConfiguration: UIImage.SymbolConfiguration(pointSize: 18, weight: .regular)) : nil, for: .normal)
        timerBtn.setTitle(timerSecs == 0 ? nil : "\(timerSecs)s", for: .normal)
        glassLit(timerBtn, timerSecs != 0)
        bwView.isHidden = !(bw && pro)
        levelView.isHidden = !(levelOn && pro)
        histView.isHidden = !(histOn && pro)
        previewLayer?.setAffineTransform(anamorphic && pro ? CGAffineTransform(scaleX: 1.33, y: 1) : .identity)
        previewLayer?.videoGravity = pro ? .resizeAspect : .resizeAspectFill
        // the foot's choices
        inner(hdrBtn, hdr)
        let can48 = maxDims().1
        mpBtn.alpha = can48 ? 1 : 0.35
        mpBtn.setTitle(big48 && can48 ? "48M" : "12M", for: .normal)
        inner(mpBtn, big48 && can48)
        inner(siBtn, !manualExposure && param == .ev)
        inner(wbBtn, param == .wb, manual: wbManual)
        inner(mfBtn, param == .focus, manual: focusManual)
        refreshPills()
        // the panel's tiles
        tiles["rapid"]?.lit = rapid
        tiles["fe"]?.lit = feLock
        tiles["grid"]?.lit = grid
        tiles["level"]?.lit = levelOn
        tiles["si"]?.lit = !manualExposure
        tiles["hist"]?.lit = histOn
        tiles["aspect"]?.word.text = ["4:3", "16:9", "1:1"][aspect]
        tiles["aspect"]?.lit = aspect != 0
        tiles["format"]?.word.text = ["JPG", "HEIF", "RAW"][format.rawValue]
        tiles["format"]?.lit = format != .jpeg
        tiles["orient"]?.lit = orientLock
        tiles["mirror"]?.lit = mirror
        tiles["anam"]?.lit = anamorphic
        tiles["raw"]?.lit = format == .raw
        tiles["raw"]?.alpha = rawType() != nil ? 1 : 0.35
        tiles["bw"]?.lit = bw
        updateInfo()
        layoutDial()
        view.setNeedsLayout()
        UIView.animate(withDuration: 0.25) { self.view.layoutIfNeeded() }
    }

    private func updateInfo() {
        if let d = device {
            infoLeft.text = String(format: "ƒ %.1f", d.lensAperture) + (pro ? (manualExposure ? "  |  M" : "  |  A") : "")
        }
        let mp = big48 && maxDims().1 ? "48 MP" : "12 MP"
        let fmt = format == .raw ? (photoOut?.isAppleProRAWEnabled == true ? "ProRAW" : "RAW") : format == .heif ? "HEIF" : "JPEG"
        infoRight.text = pro ? "\(mp)\n\(fmt)" : (mode == .video ? "VIDEO" : "DUAL")
    }

    private func toastSay(_ s: String) {
        toast.text = s
        let w = (s as NSString).size(withAttributes: [.font: toast.font as Any]).width + 32
        toast.frame = CGRect(x: (card.bounds.width - w) / 2, y: 14, width: w, height: 28)
        toast.alpha = 1
        UIView.animate(withDuration: 0.3, delay: 1.1, options: [], animations: { self.toast.alpha = 0 })
    }

    // ---- the dial ----
    private func layoutDial() {
        switch param {
        case .ev:
            dial.values = evList
            dial.majorEvery = 10
            dial.label = { String(format: "%.0f", $0) }
            dial.index = evList.firstIndex(where: { abs($0 - ev) < 0.05 }) ?? 20
        case .shutter:
            dial.values = shutterList.map { Float($0) }
            dial.majorEvery = 3
            dial.label = { v in v >= 0.25 ? String(format: "%.1f\"", v) : "1/\(Int((1 / Double(v)).rounded()))" }
            dial.index = min(shutterIndex, max(0, shutterList.count - 1))
        case .iso:
            dial.values = isoList
            dial.majorEvery = 3
            dial.label = { String(format: "%.0f", $0) }
            dial.index = min(isoIndex, max(0, isoList.count - 1))
        case .focus:
            dial.values = focusList
            dial.majorEvery = 25
            dial.label = { $0 >= 0.99 ? "∞" : String(format: "%.2f", $0) }
            dial.index = focusIndex
        case .wb:
            dial.values = wbList
            dial.majorEvery = 10
            dial.label = { String(format: "%.0fK", $0) }
            dial.index = wbIndex
        }
    }

    private func dialMoved(_ i: Int) {
        switch param {
        case .ev: ev = evList[i]; applyExposure()
        case .shutter: shutterIndex = i; manualExposure = true; applyExposure()
        case .iso: isoIndex = i; manualExposure = true; applyExposure()
        case .focus: focusIndex = i; focusManual = true; applyFocus()
        case .wb: wbIndex = i; wbManual = true; applyWB()
        }
        updateInfo()
        refreshPills()
    }

    private func refreshPills() {
        evPill.setTitle(String(format: "%+.1f EV", ev), for: .normal)
        inner(evPill, param == .ev, manual: ev != 0)
        inner(shutterPill, param == .shutter, manual: manualExposure)
        inner(isoPill, param == .iso, manual: manualExposure)
    }

    // the camera's own reading of shutter and ISO, shown on the pills
    private func readCamera() {
        guard let d = device, pro else { return }
        let secs = CMTimeGetSeconds(d.exposureDuration)
        if secs > 0 { shutterPill.setTitle(secs >= 0.25 ? String(format: "%.1f s", secs) : "1/\(Int((1 / secs).rounded())) s", for: .normal) }
        isoPill.setTitle("ISO \(Int(d.iso.rounded()))", for: .normal)
    }

    private func applyExposure() {
        guard let d = device else { return }
        let manual = manualExposure, bias = ev
        let dur = shutterList.isEmpty ? nil : CMTime(seconds: shutterList[min(shutterIndex, shutterList.count - 1)], preferredTimescale: 1_000_000)
        let iso = isoList.isEmpty ? nil : isoList[min(isoIndex, isoList.count - 1)]
        queue.async {
            do {
                try d.lockForConfiguration()
                if manual, let dur = dur, let iso = iso, d.isExposureModeSupported(.custom) {
                    let f = d.activeFormat
                    let dd = CMTimeClampToRange(dur, range: CMTimeRange(start: f.minExposureDuration, end: f.maxExposureDuration))
                    d.setExposureModeCustom(duration: dd, iso: max(f.minISO, min(f.maxISO, iso)), completionHandler: nil)
                } else {
                    if d.isExposureModeSupported(.continuousAutoExposure) { d.exposureMode = .continuousAutoExposure }
                    d.setExposureTargetBias(max(d.minExposureTargetBias, min(d.maxExposureTargetBias, bias)), completionHandler: nil)
                }
                d.unlockForConfiguration()
            } catch {}
        }
    }

    private func applyFocus() {
        guard let d = device else { return }
        let manual = focusManual, pos = focusList[focusIndex]
        queue.async {
            do {
                try d.lockForConfiguration()
                if manual, d.isLockingFocusWithCustomLensPositionSupported { d.setFocusModeLocked(lensPosition: pos, completionHandler: nil) }
                else if d.isFocusModeSupported(.continuousAutoFocus) { d.focusMode = .continuousAutoFocus }
                d.unlockForConfiguration()
            } catch {}
        }
    }

    private func applyWB() {
        guard let d = device else { return }
        let manual = wbManual, temp = wbList[wbIndex]
        queue.async {
            do {
                try d.lockForConfiguration()
                if manual, d.isLockingWhiteBalanceWithCustomDeviceGainsSupported {
                    var g = d.deviceWhiteBalanceGains(for: AVCaptureDevice.WhiteBalanceTemperatureAndTintValues(temperature: temp, tint: 0))
                    let m = d.maxWhiteBalanceGain
                    g.redGain = max(1, min(m, g.redGain)); g.greenGain = max(1, min(m, g.greenGain)); g.blueGain = max(1, min(m, g.blueGain))
                    d.setWhiteBalanceModeLocked(with: g, completionHandler: nil)
                } else if d.isWhiteBalanceModeSupported(.continuousAutoWhiteBalance) {
                    d.whiteBalanceMode = .continuousAutoWhiteBalance
                }
                d.unlockForConfiguration()
            } catch {}
        }
    }

    @objc private func pickEV() { param = .ev; tick(); refreshUI() }
    @objc private func pickShutter() { param = .shutter; startManual(); tick(); refreshUI() }
    @objc private func pickISO() { param = .iso; startManual(); tick(); refreshUI() }
    @objc private func pickSI() {
        // back to the camera's own exposure, the dial on EV
        manualExposure = false
        param = .ev
        applyExposure()
        tick()
        toastSay("Auto exposure")
        refreshUI()
    }
    @objc private func pickWB() {
        if param == .wb { wbManual = false; applyWB(); param = .ev; toastSay("Auto white balance") }
        else {
            param = .wb
            if !wbManual, let d = device {
                let t = d.temperatureAndTintValues(for: d.deviceWhiteBalanceGains).temperature
                wbIndex = wbList.firstIndex(where: { $0 >= t }) ?? 30
            }
        }
        tick()
        refreshUI()
    }
    @objc private func pickMF() {
        if param == .focus { focusManual = false; applyFocus(); param = .ev; toastSay("Auto focus") }
        else {
            param = .focus
            if !focusManual, let d = device { focusIndex = max(0, min(100, Int((d.lensPosition * 100).rounded()))) }
        }
        tick()
        refreshUI()
    }

    // shutter and ISO start from what the camera is doing now
    private func startManual() {
        guard let d = device, !manualExposure else { return }
        let secs = CMTimeGetSeconds(d.exposureDuration)
        shutterIndex = shutterList.enumerated().min(by: { abs($0.element - secs) < abs($1.element - secs) })?.offset ?? 0
        isoIndex = isoList.enumerated().min(by: { abs($0.element - d.iso) < abs($1.element - d.iso) })?.offset ?? 0
    }

    private func tick() { UISelectionFeedbackGenerator().selectionChanged() }

    // ---- the session ----
    private func bestDevice(_ pos: AVCaptureDevice.Position) -> AVCaptureDevice? {
        AVCaptureDevice.DiscoverySession(deviceTypes: [.builtInWideAngleCamera], mediaType: .video, position: pos).devices.first
    }

    // the back camera with every lens it has (it moves between them with the zoom), else the plain one
    private func backCamera() -> AVCaptureDevice? {
        let types: [AVCaptureDevice.DeviceType] = [.builtInTripleCamera, .builtInDualWideCamera, .builtInDualCamera, .builtInWideAngleCamera]
        let found = AVCaptureDevice.DiscoverySession(deviceTypes: types, mediaType: .video, position: .back).devices
        for t in types { if let d = found.first(where: { $0.deviceType == t }) { return d } }
        return nil
    }

    private func setRotation(_ c: AVCaptureConnection?, _ angle: CGFloat) {
        guard let c = c else { return }
        if #available(iOS 17.0, *) {
            if c.isVideoRotationAngleSupported(angle) { c.videoRotationAngle = angle }
        } else if c.isVideoOrientationSupported {
            c.videoOrientation = angle == 0 ? .landscapeRight : angle == 180 ? .landscapeLeft : angle == 270 ? .portraitUpsideDown : .portrait
        }
    }
    private func portrait(_ c: AVCaptureConnection?) { setRotation(c, 90) }

    // the picture on screen upright for this camera (front or back): iOS 17's rotation coordinator says the angle and
    // is followed when it changes; before iOS 17, portrait
    private func uprightPreview(_ dev: AVCaptureDevice, _ layer: AVCaptureVideoPreviewLayer) {
        if #available(iOS 17.0, *) {
            let rc = (rotCoord as? AVCaptureDevice.RotationCoordinator).flatMap { $0.device === dev && $0.previewLayer === layer ? $0 : nil }
                ?? AVCaptureDevice.RotationCoordinator(device: dev, previewLayer: layer)
            if rotCoord !== rc {
                rotCoord = rc
                rotObs = rc.observe(\.videoRotationAngleForHorizonLevelPreview, options: [.new]) { [weak self] c, _ in
                    DispatchQueue.main.async { self?.setRotation(self?.previewLayer?.connection, c.videoRotationAngleForHorizonLevelPreview) }
                }
            }
            setRotation(layer.connection, rc.videoRotationAngleForHorizonLevelPreview)
        } else {
            portrait(layer.connection)
        }
    }

    // the angle a photo or video is made at: how the phone is held (or upright when locked)
    private func captureAngle() -> CGFloat {
        if orientLock { return 90 }
        if #available(iOS 17.0, *), let rc = rotCoord as? AVCaptureDevice.RotationCoordinator { return rc.videoRotationAngleForHorizonLevelCapture }
        return shotAngle
    }

    private func configure() {
        let m = mode, f = front
        let wantsMic = m == .video
        let go = {
            self.queue.async {
                self.session?.stopRunning()
                self.session = nil
                if m == .dual && AVCaptureMultiCamSession.isMultiCamSupported { self.setupDual() } else { self.setupSingle(m, front: f) }
            }
        }
        if wantsMic { AVCaptureDevice.requestAccess(for: .audio) { _ in go() } } else { go() }
    }

    // the largest picture this camera makes (and whether that is about 48 MP)
    private func maxDims() -> (CMVideoDimensions?, Bool) {
        if #available(iOS 16.0, *), let d = device {
            let all = d.activeFormat.supportedMaxPhotoDimensions
            let top = all.max { Int($0.width) * Int($0.height) < Int($1.width) * Int($1.height) }
            return (top, (top.map { Int($0.width) * Int($0.height) } ?? 0) > 30_000_000)
        }
        return (nil, false)
    }

    private func rawType() -> OSType? {
        guard let po = photoOut else { return nil }
        if #available(iOS 14.3, *), po.isAppleProRAWEnabled {
            return po.availableRawPhotoPixelFormatTypes.first { AVCapturePhotoOutput.isAppleProRAWPixelFormat($0) }
        }
        if #available(iOS 14.3, *) {
            return po.availableRawPhotoPixelFormatTypes.first { AVCapturePhotoOutput.isBayerRAWPixelFormat($0) } ?? po.availableRawPhotoPixelFormatTypes.first
        }
        return po.availableRawPhotoPixelFormatTypes.first
    }

    private func setupSingle(_ m: Mode, front f: Bool) {
        let s = AVCaptureSession()
        s.beginConfiguration()
        s.sessionPreset = m == .video ? .high : .photo
        if lensIndex < 0 || lensFactors.isEmpty { findLenses() }
        let dev = f ? bestDevice(.front) : (lensFactors.indices.contains(lensIndex) ? lensFactors[lensIndex].1 : bestDevice(.back))
        guard let dev = dev, let input = try? AVCaptureDeviceInput(device: dev), s.canAddInput(input) else {
            s.commitConfiguration(); return
        }
        s.addInput(input)
        device = dev
        frontOut = nil
        if m == .photo && !f { useBigFormat(dev) }
        if m == .video {
            if AVCaptureDevice.authorizationStatus(for: .audio) == .authorized, let mic = AVCaptureDevice.default(for: .audio),
               let mi = try? AVCaptureDeviceInput(device: mic), s.canAddInput(mi) { s.addInput(mi) }
            let mo = AVCaptureMovieFileOutput()
            if s.canAddOutput(mo) { s.addOutput(mo) }
            mo.maxRecordedDuration = CMTime(seconds: 180, preferredTimescale: 600)
            let c = mo.connection(with: .video)
            portrait(c)
            if let c = c, c.isVideoMirroringSupported { c.automaticallyAdjustsVideoMirroring = false; c.isVideoMirrored = f }
            movieOut = mo
            photoOut = nil
        } else {
            let po = AVCapturePhotoOutput()
            if s.canAddOutput(po) { s.addOutput(po) }
            po.maxPhotoQualityPrioritization = .quality
            if #available(iOS 16.0, *), let top = dev.activeFormat.supportedMaxPhotoDimensions.max(by: { Int($0.width) * Int($0.height) < Int($1.width) * Int($1.height) }) {
                po.maxPhotoDimensions = top
            }
            if #available(iOS 14.3, *), format == .raw, po.isAppleProRAWSupported { po.isAppleProRAWEnabled = true }
            let c = po.connection(with: .video)
            portrait(c)
            if let c = c, c.isVideoMirroringSupported { c.automaticallyAdjustsVideoMirroring = false; c.isVideoMirrored = f && mirror }
            photoOut = po
            movieOut = nil
            // the frames for the histogram
            let vo = AVCaptureVideoDataOutput()
            vo.alwaysDiscardsLateVideoFrames = true
            vo.videoSettings = [kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_420YpCbCr8BiPlanarFullRange]
            vo.setSampleBufferDelegate(self, queue: frameQueue)
            if s.canAddOutput(vo) { s.addOutput(vo) }
        }
        s.commitConfiguration()
        session = s
        // the lists of shutter and ISO this camera can do
        let fmt = dev.activeFormat
        shutterList = shutters.filter { $0 >= CMTimeGetSeconds(fmt.minExposureDuration) && $0 <= CMTimeGetSeconds(fmt.maxExposureDuration) }
        isoList = isos.filter { $0 >= fmt.minISO && $0 <= fmt.maxISO }
        let layer = AVCaptureVideoPreviewLayer(session: s)
        layer.videoGravity = m == .photo ? .resizeAspect : .resizeAspectFill
        DispatchQueue.main.async {
            self.previewLayer?.removeFromSuperlayer()
            self.pipLayer?.removeFromSuperlayer()
            self.pipLayer = nil
            layer.frame = self.preview.bounds
            self.preview.layer.insertSublayer(layer, at: 0)
            self.previewLayer = layer
            self.portrait(layer.connection)
            self.uprightPreview(dev, layer)
            self.buildLenses()
            self.refreshUI()
        }
        s.startRunning()
        // once running, the picture upright again (the selfie stayed on its side)
        DispatchQueue.main.async { if self.previewLayer === layer { self.uprightPreview(dev, layer) } }
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.4) { if self.previewLayer === layer { self.uprightPreview(dev, layer) } }
        applyExposure()
        if focusManual { applyFocus() }
        if wbManual { applyWB() }
    }

    // .5 / 1 / 2-5x: the ultra wide, the wide (and its 2x where the telephoto is far or missing), the telephoto, each
    // its own camera; the telephoto's number from how much narrower it sees than the wide
    private func findLenses() {
        let types: [AVCaptureDevice.DeviceType] = [.builtInUltraWideCamera, .builtInWideAngleCamera, .builtInTelephotoCamera]
        let found = AVCaptureDevice.DiscoverySession(deviceTypes: types, mediaType: .video, position: .back).devices
        let ultra = found.first { $0.deviceType == .builtInUltraWideCamera }
        let tele = found.first { $0.deviceType == .builtInTelephotoCamera }
        guard let wide = found.first(where: { $0.deviceType == .builtInWideAngleCamera }) else { lensFactors = []; return }
        var list: [(String, AVCaptureDevice, CGFloat)] = []
        if let u = ultra { list.append((".5", u, 1)) }
        list.append(("1", wide, 1))
        var teleX: CGFloat = 0
        if let t = tele {
            let a = tan(Double(wide.activeFormat.videoFieldOfView) * .pi / 360), b = tan(Double(t.activeFormat.videoFieldOfView) * .pi / 360)
            teleX = b > 0 ? CGFloat(a / b) : 3
        }
        if tele == nil || teleX >= 3.5 { list.append(("2", wide, min(2, wide.maxAvailableVideoZoomFactor))) }
        if let t = tele { list.append((fmtX(teleX > 1 ? teleX : 3), t, 1)) }
        lensFactors = list
        lensIndex = list.firstIndex { $0.0 == "1" } ?? 0
    }

    // the format that makes the largest photo (48 MP where the camera has it), so 12M / 48M can be chosen
    private func useBigFormat(_ d: AVCaptureDevice) {
        guard #available(iOS 16.0, *) else { return }
        let area = { (f: AVCaptureDevice.Format) -> Int in f.supportedMaxPhotoDimensions.map { Int($0.width) * Int($0.height) }.max() ?? 0 }
        let now = area(d.activeFormat)
        let best = d.formats.filter { f in
            let dim = CMVideoFormatDescriptionGetDimensions(f.formatDescription)
            let sub = CMFormatDescriptionGetMediaSubType(f.formatDescription)
            return sub == kCVPixelFormatType_420YpCbCr8BiPlanarFullRange && abs(Double(dim.width) / Double(max(1, dim.height)) - 4.0 / 3.0) < 0.02
                && f.videoSupportedFrameRateRanges.contains { $0.maxFrameRate >= 30 }
        }.max { a, b in
            let x = area(a), y = area(b)
            if x != y { return x < y }
            return CMVideoFormatDescriptionGetDimensions(a.formatDescription).width < CMVideoFormatDescriptionGetDimensions(b.formatDescription).width
        }
        guard let f = best, area(f) > now else { return }
        do { try d.lockForConfiguration(); d.activeFormat = f; d.unlockForConfiguration() } catch {}
    }

    private func buildLenses() {
        lensButtons.forEach { $0.removeFromSuperview() }
        lensButtons = []
        guard !front, mode != .dual, lensFactors.count > 1 else { layoutLenses(); return }
        for (i, f) in lensFactors.enumerated() {
            let b = UIButton(type: .system)
            b.setTitle(f.0, for: .normal)
            b.titleLabel?.font = .systemFont(ofSize: 14, weight: .bold)
            b.layer.cornerRadius = 22
            b.tag = i
            b.addTarget(self, action: #selector(pickLens(_:)), for: .touchUpInside)
            lensBar.addSubview(b)
            lensButtons.append(b)
        }
        paintLenses()
        if lensFactors.indices.contains(lensIndex) { zoom(to: lensFactors[lensIndex].2, animated: false) }
        layoutLenses()
    }

    private func fmtX(_ v: CGFloat) -> String { abs(v - v.rounded()) < 0.05 ? "\(Int(v.rounded()))" : String(format: "%.1f", v) }

    private func paintLenses() {
        for (i, b) in lensButtons.enumerated() {
            let on = i == lensIndex
            b.backgroundColor = on ? camTheme.accent : .clear
            b.tintColor = on ? camTheme.ink : .white
            b.setTitleColor(on ? camTheme.ink : .white, for: .normal)
            if on { b.setTitle(lensFactors[i].0 + "×", for: .normal) } else { b.setTitle(lensFactors[i].0, for: .normal) }
        }
    }

    @objc private func pickLens(_ b: UIButton) {
        guard b.tag < lensFactors.count, b.tag != lensIndex, movieOut?.isRecording != true else { return }
        let same = lensIndex >= 0 && lensFactors[lensIndex].1 === lensFactors[b.tag].1
        lensIndex = b.tag
        paintLenses()
        tick()
        // the same camera only zooms; another camera is a new session, keeping what was set by hand
        if same { zoom(to: lensFactors[b.tag].2, animated: true) } else { configure() }
    }

    private func zoom(to z: CGFloat, animated: Bool) {
        guard let d = device else { return }
        queue.async {
            do {
                try d.lockForConfiguration()
                let v = max(d.minAvailableVideoZoomFactor, min(d.maxAvailableVideoZoomFactor, z))
                if animated { d.ramp(toVideoZoomFactor: v, withRate: 12) } else { d.videoZoomFactor = v }
                d.unlockForConfiguration()
            } catch {}
        }
    }

    // a format both cameras can hold at once (Dual stays black without one): the largest that supports multi-camera and
    // is at most maxWidth wide
    private func multiFormat(_ d: AVCaptureDevice, maxWidth: Int32) -> AVCaptureDevice.Format? {
        let ok = d.formats.filter { f in
            let dim = CMVideoFormatDescriptionGetDimensions(f.formatDescription)
            return f.isMultiCamSupported && dim.width <= maxWidth
        }
        return ok.max { a, b in
            let x = CMVideoFormatDescriptionGetDimensions(a.formatDescription), y = CMVideoFormatDescriptionGetDimensions(b.formatDescription)
            return Int(x.width) * Int(x.height) < Int(y.width) * Int(y.height)
        }
    }

    private func useFormat(_ d: AVCaptureDevice, _ f: AVCaptureDevice.Format?) {
        guard let f = f else { return }
        do { try d.lockForConfiguration(); d.activeFormat = f; d.unlockForConfiguration() } catch {}
    }

    private func dualFailed() {
        DispatchQueue.main.async { self.mode = .photo; self.refreshUI(); self.configure() }
    }

    @objc private func sessionError(_ n: Notification) {
        if mode == .dual { dualFailed() }
    }

    private func setupDual() {
        let s = AVCaptureMultiCamSession()
        s.beginConfiguration()
        guard let back = bestDevice(.back), let frontDev = bestDevice(.front),
              let bi = try? AVCaptureDeviceInput(device: back), let fi = try? AVCaptureDeviceInput(device: frontDev),
              s.canAddInput(bi), s.canAddInput(fi) else {
            s.commitConfiguration()
            dualFailed()
            return
        }
        s.addInputWithNoConnections(bi)
        s.addInputWithNoConnections(fi)
        useFormat(back, multiFormat(back, maxWidth: 1920))
        useFormat(frontDev, multiFormat(frontDev, maxWidth: 1920))
        let bo = AVCapturePhotoOutput(), fo = AVCapturePhotoOutput()
        guard s.canAddOutput(bo), s.canAddOutput(fo),
              let bp = bi.ports(for: .video, sourceDeviceType: back.deviceType, sourceDevicePosition: .back).first,
              let fp = fi.ports(for: .video, sourceDeviceType: frontDev.deviceType, sourceDevicePosition: .front).first else {
            s.commitConfiguration()
            dualFailed()
            return
        }
        s.addOutputWithNoConnections(bo)
        s.addOutputWithNoConnections(fo)
        let bc = AVCaptureConnection(inputPorts: [bp], output: bo)
        let fc = AVCaptureConnection(inputPorts: [fp], output: fo)
        if s.canAddConnection(bc) { s.addConnection(bc) }
        if s.canAddConnection(fc) { s.addConnection(fc) }
        portrait(bc)
        portrait(fc)
        if fc.isVideoMirroringSupported { fc.automaticallyAdjustsVideoMirroring = false; fc.isVideoMirrored = true }
        let bl = AVCaptureVideoPreviewLayer(sessionWithNoConnection: s)
        let fl = AVCaptureVideoPreviewLayer(sessionWithNoConnection: s)
        bl.videoGravity = .resizeAspectFill
        fl.videoGravity = .resizeAspectFill
        let blc = AVCaptureConnection(inputPort: bp, videoPreviewLayer: bl)
        let flc = AVCaptureConnection(inputPort: fp, videoPreviewLayer: fl)
        if s.canAddConnection(blc) { s.addConnection(blc) }
        if s.canAddConnection(flc) { s.addConnection(flc) }
        portrait(blc)
        portrait(flc)
        s.commitConfiguration()
        if s.hardwareCost > 1.0 {
            s.beginConfiguration()
            useFormat(back, multiFormat(back, maxWidth: 1280))
            useFormat(frontDev, multiFormat(frontDev, maxWidth: 1280))
            s.commitConfiguration()
            if s.hardwareCost > 1.0 { dualFailed(); return }
        }
        NotificationCenter.default.removeObserver(self, name: .AVCaptureSessionRuntimeError, object: nil)
        NotificationCenter.default.addObserver(self, selector: #selector(sessionError(_:)), name: .AVCaptureSessionRuntimeError, object: s)
        photoOut = bo
        frontOut = fo
        movieOut = nil
        device = back
        session = s
        DispatchQueue.main.async {
            self.previewLayer?.removeFromSuperlayer()
            self.pipLayer?.removeFromSuperlayer()
            bl.frame = self.preview.bounds
            fl.frame = self.pip.bounds
            self.preview.layer.insertSublayer(bl, at: 0)
            self.pip.layer.insertSublayer(fl, at: 0)
            self.previewLayer = bl
            self.pipLayer = fl
            self.rotObs = nil
            self.rotCoord = nil
            self.lensButtons.forEach { $0.removeFromSuperview() }
            self.lensButtons = []
            self.refreshUI()
        }
        s.startRunning()
        if !s.isRunning { dualFailed(); return }
        // the pictures upright once running (the front one came out turned)
        DispatchQueue.main.async {
            if #available(iOS 17.0, *) {
                let cb = AVCaptureDevice.RotationCoordinator(device: back, previewLayer: bl)
                let cf = AVCaptureDevice.RotationCoordinator(device: frontDev, previewLayer: fl)
                self.dualCoords = [cb, cf]
                self.queue.async {
                    self.setRotation(bl.connection, cb.videoRotationAngleForHorizonLevelPreview)
                    self.setRotation(fl.connection, cf.videoRotationAngleForHorizonLevelPreview)
                    self.setRotation(bc, cb.videoRotationAngleForHorizonLevelCapture)
                    self.setRotation(fc, cf.videoRotationAngleForHorizonLevelCapture)
                }
            } else {
                self.portrait(bl.connection); self.portrait(fl.connection); self.portrait(bc); self.portrait(fc)
            }
        }
    }

    // ---- the histogram, from every eighth frame ----
    func captureOutput(_ output: AVCaptureOutput, didOutput sampleBuffer: CMSampleBuffer, from connection: AVCaptureConnection) {
        frameCount += 1
        guard frameCount % 8 == 0, let px = CMSampleBufferGetImageBuffer(sampleBuffer) else { return }
        CVPixelBufferLockBaseAddress(px, .readOnly)
        defer { CVPixelBufferUnlockBaseAddress(px, .readOnly) }
        guard let base = CVPixelBufferGetBaseAddressOfPlane(px, 0) else { return }
        let w = CVPixelBufferGetWidthOfPlane(px, 0), h = CVPixelBufferGetHeightOfPlane(px, 0), row = CVPixelBufferGetBytesPerRowOfPlane(px, 0)
        let p = base.assumingMemoryBound(to: UInt8.self)
        var bins = [Float](repeating: 0, count: 64)
        var y = 0
        while y < h {
            var x = 0
            while x < w { bins[Int(p[y * row + x]) >> 2] += 1; x += 12 }
            y += 12
        }
        DispatchQueue.main.async { [weak self] in self?.histView.bins = bins }
    }

    func scrollViewDidScroll(_ sv: UIScrollView) {
        guard sv === pages, sv.bounds.width > 0 else { return }
        dots.currentPage = Int((sv.contentOffset.x / sv.bounds.width).rounded())
    }

    // ---- the level and which way the phone is held ----
    private func startMotion() {
        guard motion.isDeviceMotionAvailable else { return }
        motion.deviceMotionUpdateInterval = 1.0 / 30
        motion.startDeviceMotionUpdates(to: .main) { [weak self] m, _ in
            guard let self = self, let g = m?.gravity else { return }
            self.rollAngle = CGFloat(atan2(g.x, -g.y))
            if self.levelOn { self.levelView.angle = self.rollAngle }
            // which way up the photo is (90 portrait, 0 / 180 sideways, 270 upside down)
            if abs(g.x) > abs(g.y) + 0.2 { self.shotAngle = g.x > 0 ? 0 : 180 }
            else if abs(g.y) > abs(g.x) + 0.2 { self.shotAngle = g.y > 0 ? 270 : 90 }
        }
    }

    // ---- the buttons ----
    @objc private func close() {
        if movieOut?.isRecording == true { finished = true; movieOut?.stopRecording() }
        finish(["cancelled": true])
    }

    @objc private func gallery() { finish(["gallery": true]) }

    @objc private func flip() {
        guard mode != .dual, movieOut?.isRecording != true else { return }
        front.toggle()
        UIImpactFeedbackGenerator(style: .light).impactOccurred()
        UIView.transition(with: preview, duration: 0.35, options: .transitionFlipFromLeft, animations: nil)
        configure()
    }

    @objc private func toggleFlash() {
        if mode == .video {
            torchOn.toggle()
            setTorch(torchOn && movieOut?.isRecording == true)
        } else {
            flash = flash == .off ? .on : flash == .on ? .auto : .off
        }
        UIImpactFeedbackGenerator(style: .light).impactOccurred()
        refreshUI()
    }

    private func setTorch(_ on: Bool) {
        guard let d = device, d.hasTorch, !front else { return }
        queue.async {
            do { try d.lockForConfiguration(); d.torchMode = on ? .on : .off; d.unlockForConfiguration() } catch {}
        }
    }

    @objc private func nextMode() {
        guard let i = modes.firstIndex(of: mode) else { return }
        setMode(modes[(i + 1) % modes.count])
    }

    @objc private func swiped(_ g: UISwipeGestureRecognizer) {
        guard let i = modes.firstIndex(of: mode) else { return }
        let j = g.direction == .left ? i + 1 : i - 1
        if j >= 0 && j < modes.count { setMode(modes[j]) }
    }

    private func setMode(_ m: Mode) {
        guard m != mode, movieOut?.isRecording != true else { return }
        mode = m
        if m == .dual { front = false }
        UISelectionFeedbackGenerator().selectionChanged()
        toastSay(m == .photo ? "PHOTO" : m == .video ? "VIDEO" : "DUAL")
        refreshUI()
        configure()
    }

    @objc private func cycleTimer() {
        timerSecs = timerSecs == 0 ? 3 : timerSecs == 3 ? 10 : 0
        tick()
        toastSay(timerSecs == 0 ? "Timer off" : "Timer \(timerSecs)s")
        refreshUI()
    }

    @objc private func toggleHDR() { hdr.toggle(); tick(); toastSay(hdr ? "HDR on" : "HDR off"); refreshUI() }
    @objc private func toggle48() {
        guard maxDims().1 else { toastSay("48 MP is not on this lens"); return }
        big48.toggle()
        tick()
        toastSay(big48 ? "48 MP" : "12 MP")
        refreshUI()
    }

    @objc private func pinched(_ g: UIPinchGestureRecognizer) {
        guard let d = device, mode != .dual else { return }
        if g.state == .changed {
            let z = max(d.minAvailableVideoZoomFactor, min(d.maxAvailableVideoZoomFactor, 15, d.videoZoomFactor * g.scale))
            g.scale = 1
            queue.async { do { try d.lockForConfiguration(); d.videoZoomFactor = z; d.unlockForConfiguration() } catch {} }
        }
    }

    private func focusAt(_ g: UIGestureRecognizer, lock: Bool) {
        guard let d = device, let layer = previewLayer else { return }
        let pt = g.location(in: preview)
        let p = layer.captureDevicePointConverted(fromLayerPoint: pt)
        let manualF = focusManual
        queue.async {
            do {
                try d.lockForConfiguration()
                if !manualF, d.isFocusPointOfInterestSupported { d.focusPointOfInterest = p; d.focusMode = lock ? .autoFocus : .continuousAutoFocus }
                if d.isExposurePointOfInterestSupported, d.exposureMode != .custom { d.exposurePointOfInterest = p; d.exposureMode = lock ? .autoExpose : .continuousAutoExposure }
                d.unlockForConfiguration()
            } catch {}
        }
        reticle.center = g.location(in: card)
        reticle.locked = lock
        reticle.alpha = 1
        reticle.transform = CGAffineTransform(scaleX: 1.3, y: 1.3)
        UIView.animate(withDuration: 0.25, animations: { self.reticle.transform = .identity })
        if !lock { UIView.animate(withDuration: 0.4, delay: 1.6, options: [], animations: { self.reticle.alpha = 0 }) }
    }

    @objc private func focusTap(_ g: UITapGestureRecognizer) {
        if feLock { feLock = false; refreshUI() }
        focusAt(g, lock: false)
    }

    // hold on the picture: focus and exposure stay where they are (F/E lock)
    @objc private func focusHold(_ g: UILongPressGestureRecognizer) {
        guard g.state == .began else { return }
        feLock = true
        UIImpactFeedbackGenerator(style: .medium).impactOccurred()
        focusAt(g, lock: true)
        toastSay("F/E locked")
        refreshUI()
    }

    // ---- the panel ----
    @objc private func openSheet() {
        refreshUI()
        sheetBack.isHidden = false
        sheet.isHidden = false
        sheet.transform = CGAffineTransform(translationX: 0, y: sheet.bounds.height)
        UIView.animate(withDuration: 0.38, delay: 0, usingSpringWithDamping: 0.86, initialSpringVelocity: 0.3, options: [], animations: {
            self.sheetBack.alpha = 1
            self.sheet.transform = .identity
        })
    }

    @objc private func closeSheet() {
        UIView.animate(withDuration: 0.25, animations: {
            self.sheetBack.alpha = 0
            self.sheet.transform = CGAffineTransform(translationX: 0, y: self.sheet.bounds.height)
        }) { _ in self.sheet.isHidden = true; self.sheetBack.isHidden = true }
    }

    @objc private func tileTapped(_ t: ProTile) {
        tick()
        switch t.accessibilityIdentifier ?? "" {
        case "rapid": rapid.toggle(); toastSay(rapid ? "Hold the shutter for rapid fire" : "Rapid fire off")
        case "fe": feLock.toggle(); lockFE(feLock)
        case "grid": grid.toggle()
        case "level": levelOn.toggle()
        case "si": pickSI()
        case "hist": histOn.toggle()
        case "aspect": aspect = (aspect + 1) % 3
        case "format":
            let next = Format(rawValue: (format.rawValue + 1) % 3) ?? .jpeg
            setFormat(next == .raw && rawType() == nil && !rawPossible() ? .jpeg : next)
        case "orient": orientLock.toggle(); toastSay(orientLock ? "Always upright" : "Follows the phone")
        case "mirror": mirror.toggle(); applyMirror()
        case "anam": anamorphic.toggle()
        case "raw": setFormat(format == .raw ? .jpeg : .raw)
        case "bw": bw.toggle()
        default: break
        }
        refreshUI()
    }

    private func rawPossible() -> Bool { !(photoOut?.availableRawPhotoPixelFormatTypes.isEmpty ?? true) || photoOut?.isAppleProRAWSupported == true }

    private func setFormat(_ f: Format) {
        if f == .raw && !rawPossible() { toastSay("RAW is not on this iPhone"); return }
        format = f
        if #available(iOS 14.3, *), let po = photoOut, po.isAppleProRAWSupported {
            let want = f == .raw
            queue.async { if po.isAppleProRAWEnabled != want { po.isAppleProRAWEnabled = want } }
        }
        if f == .heif, photoOut?.availablePhotoCodecTypes.contains(.hevc) != true { format = .jpeg }
    }

    private func lockFE(_ on: Bool) {
        guard let d = device else { return }
        let manualF = focusManual, manualE = manualExposure
        queue.async {
            do {
                try d.lockForConfiguration()
                if on {
                    if !manualF, d.isFocusModeSupported(.locked) { d.focusMode = .locked }
                    if !manualE, d.isExposureModeSupported(.locked) { d.exposureMode = .locked }
                } else {
                    if !manualF, d.isFocusModeSupported(.continuousAutoFocus) { d.focusMode = .continuousAutoFocus }
                    if !manualE, d.isExposureModeSupported(.continuousAutoExposure) { d.exposureMode = .continuousAutoExposure }
                }
                d.unlockForConfiguration()
            } catch {}
        }
        toastSay(on ? "F/E locked" : "F/E unlocked")
    }

    private func applyMirror() {
        guard front, let c = photoOut?.connection(with: .video), c.isVideoMirroringSupported else { return }
        let m = mirror
        queue.async { c.automaticallyAdjustsVideoMirroring = false; c.isVideoMirrored = m }
    }

    // ---- taking pictures ----
    @objc private func shoot() {
        if counting { return }
        UIImpactFeedbackGenerator(style: .medium).impactOccurred()
        if mode == .video { toggleRecord(); return }
        if timerSecs > 0 { countdown(timerSecs); return }
        takeOne()
    }

    private func countdown(_ n: Int) {
        counting = true
        countLabel.isHidden = false
        var left = n
        countLabel.text = "\(left)"
        Timer.scheduledTimer(withTimeInterval: 1, repeats: true) { [weak self] t in
            guard let self = self else { t.invalidate(); return }
            left -= 1
            if left <= 0 {
                t.invalidate()
                self.countLabel.isHidden = true
                self.counting = false
                self.takeOne()
            } else {
                self.countLabel.text = "\(left)"
                UISelectionFeedbackGenerator().selectionChanged()
            }
        }
    }

    // hold the shutter in rapid fire: a photo every third of a second until let go
    @objc private func shutterHold(_ g: UILongPressGestureRecognizer) {
        guard mode == .photo, rapid, format != .raw else { return }
        if g.state == .began {
            takeOne(keepOpen: true)
            burst = Timer.scheduledTimer(withTimeInterval: 0.33, repeats: true) { [weak self] _ in self?.takeOne(keepOpen: true) }
        } else if g.state == .ended || g.state == .cancelled {
            burst?.invalidate()
            burst = nil
            if pending == 0 { finishShots() }
        }
    }

    private var keepOpen = false

    private func photoSettings() -> AVCapturePhotoSettings {
        guard let po = photoOut else { return AVCapturePhotoSettings() }
        var st: AVCapturePhotoSettings
        if mode == .photo, format == .raw, let rt = rawType() {
            st = AVCapturePhotoSettings(rawPixelFormatType: rt)
        } else if mode == .photo, format == .heif, po.availablePhotoCodecTypes.contains(.hevc) {
            st = AVCapturePhotoSettings(format: [AVVideoCodecKey: AVVideoCodecType.hevc])
        } else {
            st = AVCapturePhotoSettings(format: [AVVideoCodecKey: AVVideoCodecType.jpeg])
        }
        if !front, mode == .photo, format != .raw, po.supportedFlashModes.contains(flash) { st.flashMode = flash }
        if mode == .photo, format != .raw {
            let want: AVCapturePhotoOutput.QualityPrioritization = hdr ? .quality : .speed
            st.photoQualityPrioritization = want.rawValue <= po.maxPhotoQualityPrioritization.rawValue ? want : po.maxPhotoQualityPrioritization
        }
        if #available(iOS 16.0, *), mode == .photo, let d = device {
            let all = d.activeFormat.supportedMaxPhotoDimensions.sorted { Int($0.width) * Int($0.height) < Int($1.width) * Int($1.height) }
            // only a size the output takes (a bigger one throws and closes the app)
            let cap = po.maxPhotoDimensions
            let fits = all.filter { $0.width <= cap.width && $0.height <= cap.height }
            if big48, let top = fits.last { st.maxPhotoDimensions = top }
            else if let twelve = fits.last(where: { Int($0.width) * Int($0.height) <= 13_000_000 }) ?? fits.first { st.maxPhotoDimensions = twelve }
        }
        return st
    }

    private func takeOne(keepOpen open: Bool = false) {
        guard let po = photoOut else { return }
        keepOpen = open
        dualParts = [:]
        let angle = captureAngle()
        if mode == .photo { setRotation(po.connection(with: .video), angle) }
        let st = photoSettings()
        let take = {
            self.pending += 1
            po.capturePhoto(with: st, delegate: self)
            if self.mode == .dual, let fo = self.frontOut { fo.capturePhoto(with: AVCapturePhotoSettings(), delegate: self) }
        }
        UIView.animate(withDuration: 0.08, animations: { self.shutter.transform = CGAffineTransform(scaleX: 0.9, y: 0.9) }) { _ in
            UIView.animate(withDuration: 0.12) { self.shutter.transform = .identity }
        }
        // a short dark blink, as a real shutter
        let blink = UIView(frame: card.bounds)
        blink.backgroundColor = .black
        blink.isUserInteractionEnabled = false
        card.addSubview(blink)
        UIView.animate(withDuration: 0.18, animations: { blink.alpha = 0 }) { _ in blink.removeFromSuperview() }
        if front && mode == .photo && flash != .off {
            // the front camera's flash: the screen lights up white, bright, while the photo is taken
            let was = UIScreen.main.brightness
            UIScreen.main.brightness = 1
            white.alpha = 1
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.25) {
                take()
                DispatchQueue.main.asyncAfter(deadline: .now() + 0.35) {
                    UIView.animate(withDuration: 0.3) { self.white.alpha = 0 }
                    UIScreen.main.brightness = was
                }
            }
        } else {
            take()
        }
    }

    private func toggleRecord() {
        guard let mo = movieOut else { return }
        if mo.isRecording { mo.stopRecording(); return }
        let url = FileManager.default.temporaryDirectory.appendingPathComponent("VID_\(Int(Date().timeIntervalSince1970)).mov")
        try? FileManager.default.removeItem(at: url)
        setTorch(torchOn)
        let va = captureAngle()
        setRotation(mo.connection(with: .video), va)
        queue.async { mo.startRecording(to: url, recordingDelegate: self) }
        recordStart = Date()
        timeLabel.text = "0:00"
        timeLabel.isHidden = false
        flipBtn.isEnabled = false
        modeBtn.isEnabled = false
        ticker = Timer.scheduledTimer(withTimeInterval: 0.5, repeats: true) { [weak self] _ in
            guard let self = self, let s = self.recordStart else { return }
            let t = Int(Date().timeIntervalSince(s))
            self.timeLabel.text = "\(t / 60):" + String(format: "%02d", t % 60)
        }
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.1) { UIView.animate(withDuration: 0.2) { self.layoutShutter() } }
    }

    // ---- what comes back ----
    func photoOutput(_ output: AVCapturePhotoOutput, didFinishProcessingPhoto photo: AVCapturePhoto, error: Error?) {
        let isFront = output === frontOut
        let isRaw = photo.isRawPhoto
        let data = error == nil ? photo.fileDataRepresentation() : nil
        DispatchQueue.main.async {
            if !isFront { self.pending = max(0, self.pending - 1) }
            guard let data = data else { self.afterShot(); return }
            if self.mode == .dual {
                guard let img = UIImage(data: data) else { return }
                self.dualParts[isFront] = img
                if let b = self.dualParts[false], let f = self.dualParts[true] { self.save(jpeg: self.compose(back: b, front: f).jpegData(compressionQuality: 0.9)) }
                return
            }
            if isRaw { self.save(raw: data); return }
            if self.aspect != 0 || self.anamorphic || self.bw, let img = UIImage(data: data) {
                self.save(jpeg: self.develop(img).jpegData(compressionQuality: 0.92))
            } else {
                self.save(data: data, ext: self.format == .heif ? "heic" : "jpg", type: self.format == .heif ? "image/heic" : "image/jpeg")
            }
        }
    }

    // the aspect's crop, the anamorphic stretch and black and white, on the photo itself
    private func develop(_ src: UIImage) -> UIImage {
        let fmt = UIGraphicsImageRendererFormat()
        fmt.scale = 1
        var img = UIGraphicsImageRenderer(size: src.size, format: fmt).image { _ in src.draw(at: .zero) }
        let W = img.size.width, H = img.size.height
        if aspect != 0 {
            let target: CGFloat = aspect == 2 ? 1 : (W >= H ? 16.0 / 9.0 : 9.0 / 16.0)
            var cw = W, ch = W / target
            if ch > H { ch = H; cw = H * target }
            let r = CGRect(x: (W - cw) / 2, y: (H - ch) / 2, width: cw, height: ch)
            img = UIGraphicsImageRenderer(size: r.size, format: fmt).image { _ in img.draw(at: CGPoint(x: -r.minX, y: -r.minY)) }
        }
        if anamorphic {
            let size = CGSize(width: (img.size.width * 1.33).rounded(), height: img.size.height)
            img = UIGraphicsImageRenderer(size: size, format: fmt).image { _ in img.draw(in: CGRect(origin: .zero, size: size)) }
        }
        if bw, let cg = img.cgImage {
            let input = CIImage(cgImage: cg)
            let f = CIFilter(name: "CIColorControls")
            f?.setValue(input, forKey: kCIInputImageKey)
            f?.setValue(0, forKey: kCIInputSaturationKey)
            f?.setValue(1.06, forKey: kCIInputContrastKey)
            if let out = f?.outputImage, let made = ci.createCGImage(out, from: input.extent) { img = UIImage(cgImage: made) }
        }
        return img
    }

    // the back camera's photo with the front one in a rounded corner, as on screen
    private func compose(back: UIImage, front: UIImage) -> UIImage {
        let size = back.size
        let fmt = UIGraphicsImageRendererFormat()
        fmt.scale = 1
        return UIGraphicsImageRenderer(size: size, format: fmt).image { _ in
            back.draw(in: CGRect(origin: .zero, size: size))
            let pw = size.width * 0.3
            let ph = pw * (front.size.height / max(1, front.size.width))
            let m = size.width * 0.045
            let r = CGRect(x: size.width - pw - m, y: m * 1.6, width: pw, height: ph)
            let path = UIBezierPath(roundedRect: r, cornerRadius: pw * 0.1)
            UIColor(white: 0, alpha: 0.35).setFill()
            path.fill()
            path.addClip()
            front.draw(in: r)
        }
    }

    private var rawShot = false

    private func save(jpeg: Data?) { save(data: jpeg, ext: "jpg", type: "image/jpeg") }
    private func save(raw: Data) { rawShot = true; save(data: raw, ext: "dng", type: "image/x-adobe-dng") }

    private func save(data: Data?, ext: String, type: String) {
        guard let data = data else { afterShot(); return }
        let name = "IMG_\(Int(Date().timeIntervalSince1970 * 1000)).\(ext)"
        let url = FileManager.default.temporaryDirectory.appendingPathComponent(name)
        do { try data.write(to: url) } catch { afterShot(); return }
        shots.append(url.absoluteString)
        lastType = type
        afterShot()
    }

    private var lastType = "image/jpeg"

    private func afterShot() {
        if keepOpen || burst != nil {
            toastSay("\(shots.count) taken")
            if burst == nil && pending == 0 { finishShots() }
            return
        }
        finishShots()
    }

    private func finishShots() {
        guard !shots.isEmpty else { return }
        if shots.count == 1 {
            finish(["path": shots[0], "type": lastType, "name": (shots[0] as NSString).lastPathComponent, "raw": rawShot])
        } else {
            finish(["paths": shots, "type": lastType, "raw": rawShot])
        }
    }

    func fileOutput(_ output: AVCaptureFileOutput, didFinishRecordingTo url: URL, from connections: [AVCaptureConnection], error: Error?) {
        var ok = error == nil
        if let e = error as NSError?, let v = e.userInfo[AVErrorRecordingSuccessfullyFinishedKey] as? Bool { ok = v }
        DispatchQueue.main.async {
            self.ticker?.invalidate()
            self.ticker = nil
            self.setTorch(false)
            self.timeLabel.isHidden = true
            self.flipBtn.isEnabled = true
            self.modeBtn.isEnabled = true
            self.layoutShutter()
            if self.finished { try? FileManager.default.removeItem(at: url); return }
            if ok { self.finish(["path": url.absoluteString, "type": "video/quicktime", "name": url.lastPathComponent]) }
        }
    }

    private func loadGalleryThumb() {
        let st = PHPhotoLibrary.authorizationStatus(for: .readWrite)
        guard st == .authorized || st == .limited else { return }
        let opts = PHFetchOptions()
        opts.sortDescriptors = [NSSortDescriptor(key: "creationDate", ascending: false)]
        opts.fetchLimit = 1
        guard let a = PHAsset.fetchAssets(with: opts).firstObject else { return }
        let ro = PHImageRequestOptions()
        ro.deliveryMode = .opportunistic
        PHImageManager.default().requestImage(for: a, targetSize: CGSize(width: 156, height: 156), contentMode: .aspectFill, options: ro) { img, _ in
            guard let img = img else { return }
            DispatchQueue.main.async {
                self.galleryBtn.setImage(img, for: .normal)
                self.galleryBtn.layer.borderColor = camTheme.accent.cgColor
                self.galleryBtn.layer.borderWidth = 2
            }
        }
    }

    private func finish(_ result: [String: Any]) {
        if finished && result["cancelled"] == nil { return }
        finished = true
        ticker?.invalidate()
        readTimer?.invalidate()
        burst?.invalidate()
        motion.stopDeviceMotionUpdates()
        let s = session
        queue.async { s?.stopRunning() }
        let cb = done
        done = nil
        dismiss(animated: true) { cb?(result) }
    }
}

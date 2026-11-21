// RoarMe's own camera inside the iPhone app (Alex, 21 Nov: "when you open the camera anywhere in the app, these
// features", from a camera with VIDEO · PHOTO · DUAL; "all together now"). A full-screen native screen: X, flip,
// flash (photo: off / on / auto; video: the torch), the shutter, the newest photo of the library to go to the Gallery,
// and the modes under it: VIDEO (with the time while recording, at most 3 minutes), PHOTO, DUAL (back and front at
// once, iPhone XS and later: one photo with the front camera in a rounded corner). The front camera's flash is the
// screen lighting up. The plugin answers the page (src/camera.js) with the file it made, which the page then opens in
// its editor. Added to the app by .github/workflows/ios.yml with RoarViewController.swift, which registers it.
import UIKit
import AVFoundation
import Photos
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
        call.resolve(["ok": true, "dual": AVCaptureMultiCamSession.isMultiCamSupported])
    }

    @objc func open(_ call: CAPPluginCall) {
        let only = call.getString("only") ?? ""
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

final class RoarCameraController: UIViewController, AVCapturePhotoCaptureDelegate, AVCaptureFileOutputRecordingDelegate {
    enum Mode: Int { case video = 0, photo = 1, dual = 2 }

    var only = ""
    var done: (([String: Any]) -> Void)?

    private var mode: Mode = .photo
    private var front = false
    private var flash: AVCaptureDevice.FlashMode = .off
    private var torchOn = false
    private let queue = DispatchQueue(label: "roarme.camera")
    private var session: AVCaptureSession?
    private var photoOut: AVCapturePhotoOutput?
    private var frontOut: AVCapturePhotoOutput?
    private var movieOut: AVCaptureMovieFileOutput?
    private var device: AVCaptureDevice?
    private var dualParts: [Bool: UIImage] = [:]
    private var finished = false
    private var recordStart: Date?
    private var ticker: Timer?

    private let card = UIView()
    private let preview = UIView()
    private let pip = UIView()
    private var previewLayer: AVCaptureVideoPreviewLayer?
    private var pipLayer: AVCaptureVideoPreviewLayer?
    private let closeBtn = UIButton(type: .system)
    private let flipBtn = UIButton(type: .system)
    private let flashBtn = UIButton(type: .system)
    private let shutter = UIButton(type: .custom)
    private let shutterInner = UIView()
    private let shutterIcon = UIImageView()
    private let galleryBtn = UIButton(type: .custom)
    private let timeLabel = UILabel()
    private let modeBar = UIView()
    private var modeButtons: [Mode: UIButton] = [:]
    private let white = UIView()

    deinit { NotificationCenter.default.removeObserver(self) }

    override var preferredStatusBarStyle: UIStatusBarStyle { .lightContent }
    override var supportedInterfaceOrientations: UIInterfaceOrientationMask { .portrait }

    private var modes: [Mode] {
        if only == "photo" { return [.photo] }
        return AVCaptureMultiCamSession.isMultiCamSupported ? [.video, .photo, .dual] : [.video, .photo]
    }

    override func viewDidLoad() {
        super.viewDidLoad()
        overrideUserInterfaceStyle = .dark
        view.backgroundColor = .black

        card.backgroundColor = UIColor(white: 0.08, alpha: 1)
        card.layer.cornerRadius = 22
        card.clipsToBounds = true
        view.addSubview(card)
        preview.backgroundColor = .black
        card.addSubview(preview)
        pip.backgroundColor = .black
        pip.layer.cornerRadius = 18
        pip.clipsToBounds = true
        pip.isHidden = true
        card.addSubview(pip)

        let cfg = UIImage.SymbolConfiguration(pointSize: 22, weight: .semibold)
        closeBtn.setImage(UIImage(systemName: "xmark", withConfiguration: cfg), for: .normal)
        flipBtn.setImage(UIImage(systemName: "arrow.triangle.2.circlepath.camera.fill", withConfiguration: cfg), for: .normal)
        for b in [closeBtn, flipBtn, flashBtn] {
            b.tintColor = .white
            b.layer.shadowColor = UIColor.black.cgColor
            b.layer.shadowOpacity = 0.35
            b.layer.shadowRadius = 6
            b.layer.shadowOffset = .zero
            card.addSubview(b)
        }
        closeBtn.addTarget(self, action: #selector(close), for: .touchUpInside)
        flipBtn.addTarget(self, action: #selector(flip), for: .touchUpInside)
        flashBtn.addTarget(self, action: #selector(toggleFlash), for: .touchUpInside)

        timeLabel.font = .monospacedDigitSystemFont(ofSize: 15, weight: .semibold)
        timeLabel.textColor = .white
        timeLabel.textAlignment = .center
        timeLabel.backgroundColor = UIColor(red: 1, green: 0.23, blue: 0.19, alpha: 1)
        timeLabel.layer.cornerRadius = 13
        timeLabel.clipsToBounds = true
        timeLabel.isHidden = true
        card.addSubview(timeLabel)

        shutter.layer.borderWidth = 0
        shutter.backgroundColor = UIColor(white: 1, alpha: 0.32)
        shutter.layer.cornerRadius = 39
        shutter.addTarget(self, action: #selector(shoot), for: .touchUpInside)
        card.addSubview(shutter)
        shutterInner.isUserInteractionEnabled = false
        shutterInner.backgroundColor = .white
        shutter.addSubview(shutterInner)
        shutterIcon.tintColor = UIColor(red: 0.04, green: 0.52, blue: 1, alpha: 1)
        shutterIcon.contentMode = .center
        shutterIcon.isUserInteractionEnabled = false
        shutter.addSubview(shutterIcon)

        galleryBtn.backgroundColor = UIColor(white: 0, alpha: 0.45)
        galleryBtn.layer.cornerRadius = 12
        galleryBtn.clipsToBounds = true
        galleryBtn.layer.borderColor = UIColor.white.cgColor
        galleryBtn.layer.borderWidth = 0
        galleryBtn.tintColor = .white
        galleryBtn.setImage(UIImage(systemName: "photo.on.rectangle", withConfiguration: UIImage.SymbolConfiguration(pointSize: 20, weight: .semibold)), for: .normal)
        galleryBtn.imageView?.contentMode = .scaleAspectFill
        galleryBtn.addTarget(self, action: #selector(gallery), for: .touchUpInside)
        galleryBtn.isHidden = only == "photo"
        card.addSubview(galleryBtn)

        view.addSubview(modeBar)
        for m in modes {
            let b = UIButton(type: .system)
            b.setTitle(m == .video ? "VIDEO" : m == .photo ? "PHOTO" : "DUAL", for: .normal)
            b.titleLabel?.font = .systemFont(ofSize: 15, weight: .semibold)
            b.tag = m.rawValue
            b.addTarget(self, action: #selector(pickMode(_:)), for: .touchUpInside)
            modeBar.addSubview(b)
            modeButtons[m] = b
        }
        let left = UISwipeGestureRecognizer(target: self, action: #selector(swiped(_:)))
        left.direction = .left
        let right = UISwipeGestureRecognizer(target: self, action: #selector(swiped(_:)))
        right.direction = .right
        card.addGestureRecognizer(left)
        card.addGestureRecognizer(right)
        let pinch = UIPinchGestureRecognizer(target: self, action: #selector(pinched(_:)))
        preview.addGestureRecognizer(pinch)
        let tap = UITapGestureRecognizer(target: self, action: #selector(focusTap(_:)))
        preview.addGestureRecognizer(tap)

        white.backgroundColor = .white
        white.alpha = 0
        white.isUserInteractionEnabled = false
        view.addSubview(white)

        refreshUI()
        loadGalleryThumb()
        AVCaptureDevice.requestAccess(for: .video) { ok in
            DispatchQueue.main.async {
                if ok { self.configure() } else { self.finish(["error": "camera"]) }
            }
        }
    }

    override func viewDidLayoutSubviews() {
        super.viewDidLayoutSubviews()
        let s = view.safeAreaInsets
        let w = view.bounds.width
        let bottomBar: CGFloat = 76
        card.frame = CGRect(x: 0, y: s.top + 6, width: w, height: view.bounds.height - s.top - 6 - s.bottom - bottomBar)
        preview.frame = card.bounds
        previewLayer?.frame = preview.bounds
        let pw = round(w * 0.3), ph = round(pw * 16 / 9 * 0.92)
        pip.frame = CGRect(x: w - pw - 18, y: 64, width: pw, height: ph)
        pipLayer?.frame = pip.bounds
        closeBtn.frame = CGRect(x: 12, y: 12, width: 48, height: 48)
        flashBtn.frame = CGRect(x: w - 60, y: 12, width: 48, height: 48)
        flipBtn.frame = CGRect(x: w - 116, y: 12, width: 48, height: 48)
        timeLabel.frame = CGRect(x: (w - 78) / 2, y: 22, width: 78, height: 26)
        let sh: CGFloat = 78
        shutter.frame = CGRect(x: (w - sh) / 2, y: card.bounds.height - sh - 26, width: sh, height: sh)
        layoutShutter()
        galleryBtn.frame = CGRect(x: 26, y: shutter.frame.midY - 26, width: 52, height: 52)
        modeBar.frame = CGRect(x: 0, y: card.frame.maxY, width: w, height: bottomBar)
        layoutModes()
        white.frame = view.bounds
    }

    private func layoutModes() {
        let gap: CGFloat = 26
        let sizes = modes.map { ($0, modeButtons[$0]!.intrinsicContentSize.width) }
        // the chosen mode stands in the middle, the others beside it
        guard let idx = modes.firstIndex(of: mode) else { return }
        var x = view.bounds.width / 2 - sizes[idx].1 / 2
        for i in stride(from: idx - 1, through: 0, by: -1) { x -= gap + sizes[i].1 }
        for (m, w) in sizes {
            modeButtons[m]?.frame = CGRect(x: x, y: 18, width: w, height: 30)
            x += w + gap
        }
    }

    private func layoutShutter() {
        let b = shutter.bounds
        let recording = movieOut?.isRecording == true
        if mode == .video && recording {
            shutterInner.frame = CGRect(x: b.midX - 15, y: b.midY - 15, width: 30, height: 30)
            shutterInner.layer.cornerRadius = 7
            shutterInner.backgroundColor = UIColor(red: 1, green: 0.23, blue: 0.19, alpha: 1)
        } else {
            shutterInner.frame = b.insetBy(dx: 8, dy: 8)
            shutterInner.layer.cornerRadius = shutterInner.frame.width / 2
            shutterInner.backgroundColor = .white
        }
        shutterIcon.frame = b
        let cfg = UIImage.SymbolConfiguration(pointSize: 24, weight: .semibold)
        shutterIcon.image = mode == .dual ? UIImage(systemName: "camera.fill", withConfiguration: cfg)
            : (mode == .video && !recording) ? UIImage(systemName: "circle.fill", withConfiguration: UIImage.SymbolConfiguration(pointSize: 20, weight: .bold)) : nil
        shutterIcon.tintColor = mode == .video ? UIColor(red: 1, green: 0.23, blue: 0.19, alpha: 1) : UIColor(red: 0.04, green: 0.52, blue: 1, alpha: 1)
    }

    private func refreshUI() {
        for (m, b) in modeButtons { b.tintColor = m == mode ? .white : UIColor(white: 1, alpha: 0.45) }
        let cfg = UIImage.SymbolConfiguration(pointSize: 21, weight: .semibold)
        let name: String
        if mode == .video { name = torchOn ? "flashlight.on.fill" : "flashlight.off.fill" }
        else { name = flash == .on ? "bolt.fill" : flash == .auto ? "bolt.badge.a.fill" : "bolt.slash.fill" }
        flashBtn.setImage(UIImage(systemName: name, withConfiguration: cfg), for: .normal)
        flashBtn.tintColor = (mode == .video ? torchOn : flash != .off) ? UIColor(red: 1, green: 0.84, blue: 0.04, alpha: 1) : .white
        flashBtn.isHidden = mode == .dual
        flipBtn.isHidden = mode == .dual
        pip.isHidden = mode != .dual
        view.setNeedsLayout()
        UIView.animate(withDuration: 0.25) { self.view.layoutIfNeeded() }
    }

    // ---- the session ----
    private func bestDevice(_ pos: AVCaptureDevice.Position) -> AVCaptureDevice? {
        AVCaptureDevice.DiscoverySession(deviceTypes: [.builtInWideAngleCamera], mediaType: .video, position: pos).devices.first
    }

    private func portrait(_ c: AVCaptureConnection?) {
        guard let c = c else { return }
        if #available(iOS 17.0, *) {
            if c.isVideoRotationAngleSupported(90) { c.videoRotationAngle = 90 }
        } else if c.isVideoOrientationSupported {
            c.videoOrientation = .portrait
        }
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

    private func setupSingle(_ m: Mode, front f: Bool) {
        let s = AVCaptureSession()
        s.beginConfiguration()
        s.sessionPreset = m == .video ? .high : .photo
        guard let dev = bestDevice(f ? .front : .back), let input = try? AVCaptureDeviceInput(device: dev), s.canAddInput(input) else {
            s.commitConfiguration(); return
        }
        s.addInput(input)
        device = dev
        frontOut = nil
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
            let c = po.connection(with: .video)
            portrait(c)
            if let c = c, c.isVideoMirroringSupported { c.automaticallyAdjustsVideoMirroring = false; c.isVideoMirrored = f }
            photoOut = po
            movieOut = nil
        }
        s.commitConfiguration()
        session = s
        let layer = AVCaptureVideoPreviewLayer(session: s)
        layer.videoGravity = .resizeAspectFill
        DispatchQueue.main.async {
            self.previewLayer?.removeFromSuperlayer()
            self.pipLayer?.removeFromSuperlayer()
            self.pipLayer = nil
            layer.frame = self.preview.bounds
            self.preview.layer.insertSublayer(layer, at: 0)
            self.previewLayer = layer
            self.portrait(layer.connection)
        }
        s.startRunning()
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
        // too much for this iPhone at once: smaller formats, else back to Photo
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
        }
        s.startRunning()
        if !s.isRunning { dualFailed() }
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

    @objc private func pickMode(_ b: UIButton) {
        guard let m = Mode(rawValue: b.tag) else { return }
        setMode(m)
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
        refreshUI()
        configure()
    }

    @objc private func pinched(_ g: UIPinchGestureRecognizer) {
        guard let d = device, mode != .dual else { return }
        if g.state == .changed {
            let z = max(1, min(d.activeFormat.videoMaxZoomFactor, 6, d.videoZoomFactor * g.scale))
            g.scale = 1
            queue.async { do { try d.lockForConfiguration(); d.videoZoomFactor = z; d.unlockForConfiguration() } catch {} }
        }
    }

    @objc private func focusTap(_ g: UITapGestureRecognizer) {
        guard let d = device, let layer = previewLayer else { return }
        let p = layer.captureDevicePointConverted(fromLayerPoint: g.location(in: preview))
        queue.async {
            do {
                try d.lockForConfiguration()
                if d.isFocusPointOfInterestSupported { d.focusPointOfInterest = p; d.focusMode = .autoFocus }
                if d.isExposurePointOfInterestSupported { d.exposurePointOfInterest = p; d.exposureMode = .autoExpose }
                d.unlockForConfiguration()
            } catch {}
        }
        let ring = UIView(frame: CGRect(x: 0, y: 0, width: 70, height: 70))
        ring.center = g.location(in: preview)
        ring.layer.borderColor = UIColor(red: 1, green: 0.84, blue: 0.04, alpha: 1).cgColor
        ring.layer.borderWidth = 1.5
        ring.layer.cornerRadius = 8
        preview.addSubview(ring)
        ring.transform = CGAffineTransform(scaleX: 1.4, y: 1.4)
        UIView.animate(withDuration: 0.25, animations: { ring.transform = .identity }) { _ in
            UIView.animate(withDuration: 0.3, delay: 0.5, options: [], animations: { ring.alpha = 0 }) { _ in ring.removeFromSuperview() }
        }
    }

    @objc private func shoot() {
        UIImpactFeedbackGenerator(style: .medium).impactOccurred()
        if mode == .video { toggleRecord(); return }
        guard let po = photoOut else { return }
        dualParts = [:]
        let take = {
            let st = AVCapturePhotoSettings()
            if !self.front && self.mode == .photo && po.supportedFlashModes.contains(self.flash) { st.flashMode = self.flash }
            po.capturePhoto(with: st, delegate: self)
            if self.mode == .dual, let fo = self.frontOut { fo.capturePhoto(with: AVCapturePhotoSettings(), delegate: self) }
        }
        UIView.animate(withDuration: 0.08, animations: { self.shutter.transform = CGAffineTransform(scaleX: 0.9, y: 0.9) }) { _ in
            UIView.animate(withDuration: 0.12) { self.shutter.transform = .identity }
        }
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
        queue.async { mo.startRecording(to: url, recordingDelegate: self) }
        recordStart = Date()
        timeLabel.text = "0:00"
        timeLabel.isHidden = false
        flipBtn.isEnabled = false
        for b in modeButtons.values { b.isEnabled = false }
        ticker = Timer.scheduledTimer(withTimeInterval: 0.5, repeats: true) { [weak self] _ in
            guard let self = self, let s = self.recordStart else { return }
            let t = Int(Date().timeIntervalSince(s))
            self.timeLabel.text = "\(t / 60):" + String(format: "%02d", t % 60)
        }
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.1) { UIView.animate(withDuration: 0.2) { self.layoutShutter() } }
    }

    // ---- what comes back ----
    func photoOutput(_ output: AVCapturePhotoOutput, didFinishProcessingPhoto photo: AVCapturePhoto, error: Error?) {
        guard error == nil, let data = photo.fileDataRepresentation(), let img = UIImage(data: data) else { return }
        let isFront = output === frontOut
        DispatchQueue.main.async {
            if self.mode == .dual {
                self.dualParts[isFront] = img
                if let b = self.dualParts[false], let f = self.dualParts[true] { self.saveImage(self.compose(back: b, front: f)) }
                return
            }
            self.saveImage(img)
        }
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

    private func saveImage(_ img: UIImage) {
        guard let data = img.jpegData(compressionQuality: 0.9) else { return }
        let name = "IMG_\(Int(Date().timeIntervalSince1970)).jpg"
        let url = FileManager.default.temporaryDirectory.appendingPathComponent(name)
        do { try data.write(to: url) } catch { return }
        finish(["path": url.absoluteString, "type": "image/jpeg", "name": name])
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
            for b in self.modeButtons.values { b.isEnabled = true }
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
                self.galleryBtn.layer.borderWidth = 2
            }
        }
    }

    private func finish(_ result: [String: Any]) {
        if finished && result["cancelled"] == nil { return }
        finished = true
        ticker?.invalidate()
        let s = session
        queue.async { s?.stopRunning() }
        let cb = done
        done = nil
        dismiss(animated: true) { cb?(result) }
    }
}

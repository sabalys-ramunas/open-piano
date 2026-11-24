import AVFoundation
import CoreAudioKit
import UIKit
import WebKit

@main
final class AppDelegate: UIResponder, UIApplicationDelegate {
    var window: UIWindow?

    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {
        configureAudioSession()
        observeAudioSession()
        // The player's hands are on the piano, not the screen: keep it awake.
        application.isIdleTimerDisabled = true
        let window = UIWindow(frame: UIScreen.main.bounds)
        window.rootViewController = WebViewController()
        window.makeKeyAndVisible()
        self.window = window
        return true
    }

    /// The .playback category plays lesson audio with the silent switch on.
    /// Microphone capture is not set here: WebKit switches the session while
    /// getUserMedia is capturing (not verified on a device, see the report).
    private func configureAudioSession() {
        do {
            try AVAudioSession.sharedInstance().setCategory(.playback, mode: .default, options: [])
        } catch {
            NSLog("[audio] setCategory failed: %@", error.localizedDescription)
        }
    }

    /// Calls, Siri and alarms interrupt playback. When they end, take the session back
    /// if the system says playback may resume. The media services reset (rare) drops the category.
    private func observeAudioSession() {
        let center = NotificationCenter.default
        center.addObserver(forName: AVAudioSession.interruptionNotification, object: nil, queue: .main) { note in
            guard let raw = note.userInfo?[AVAudioSessionInterruptionTypeKey] as? UInt,
                  let type = AVAudioSession.InterruptionType(rawValue: raw),
                  type == .ended
            else { return }
            let options = AVAudioSession.InterruptionOptions(rawValue: (note.userInfo?[AVAudioSessionInterruptionOptionKey] as? UInt) ?? 0)
            if options.contains(.shouldResume) {
                do { try AVAudioSession.sharedInstance().setActive(true) } catch {
                    NSLog("[audio] reactivate failed: %@", error.localizedDescription)
                }
            }
        }
        center.addObserver(forName: AVAudioSession.mediaServicesWereResetNotification, object: nil, queue: .main) { [weak self] _ in
            self?.configureAudioSession()
        }
    }
}

/// The whole app is one web view showing the bundled web app, plus the MIDI
/// bridge that the system web view lacks.
final class WebViewController: UIViewController, WKScriptMessageHandler, WKNavigationDelegate, WKUIDelegate, WKDownloadDelegate {
    private let midi = MIDIBridge()
    private var webView: WKWebView!
    /// Save-in-progress files: the download's temporary file. Its folder is removed once the share sheet closes.
    private var downloads: [ObjectIdentifier: URL] = [:]
    private weak var bluetoothSheet: UIViewController?

    /// Schemes the page may load in its own frames and main frame.
    private static let appSchemes: Set<String> = [WebFiles.scheme, "blob", "about", "data"]

    override var prefersStatusBarHidden: Bool { true }
    override var prefersHomeIndicatorAutoHidden: Bool { true }

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = UIColor(named: "LaunchBackground")

        let config = WKWebViewConfiguration()
        config.setURLSchemeHandler(WebFiles(), forURLScheme: WebFiles.scheme)
        config.allowsInlineMediaPlayback = true
        config.mediaTypesRequiringUserActionForPlayback = []
        if let file = Bundle.main.url(forResource: "midi-polyfill", withExtension: "js"), let source = try? String(contentsOf: file, encoding: .utf8) {
            config.userContentController.addUserScript(WKUserScript(source: source, injectionTime: .atDocumentStart, forMainFrameOnly: true))
        }
        config.userContentController.add(self, name: "midi")
        #if DEBUG
        // Page errors and a "loaded" report show up in the Xcode console.
        config.userContentController.add(self, name: "log")
        config.userContentController.addUserScript(WKUserScript(source: """
            (function () {
              var send = function (text) { window.webkit.messageHandlers.log.postMessage(String(text)); };
              window.addEventListener('error', function (e) { send('error: ' + (e.message || (e.target && (e.target.src || e.target.href)) || e)); }, true);
              window.addEventListener('unhandledrejection', function (e) { send('rejection: ' + (e.reason && e.reason.message || e.reason)); });
              var error = console.error; console.error = function () { send('console.error: ' + Array.prototype.join.call(arguments, ' ')); error.apply(console, arguments); };
              window.addEventListener('load', function () { setTimeout(function () {
                send('loaded: ' + location.href + ' | title=' + document.title + ' | elements=' + document.querySelectorAll('*').length
                  + ' | secure=' + window.isSecureContext + ' | midi=' + (typeof navigator.requestMIDIAccess) + ' | idb=' + (typeof indexedDB)
                  + ' | mic=' + Boolean(navigator.mediaDevices && navigator.mediaDevices.getUserMedia) + ' | text=' + document.body.innerText.slice(0, 120).replace(/\\n/g, ' / '));
              }, 3000); });
            })();
            """, injectionTime: .atDocumentStart, forMainFrameOnly: true))
        #endif

        webView = WKWebView(frame: view.bounds, configuration: config)
        webView.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        webView.navigationDelegate = self
        webView.uiDelegate = self
        webView.isOpaque = false
        webView.backgroundColor = .clear
        // Full-screen web view that handles the safe areas itself (viewport-fit=cover and env()).
        webView.scrollView.contentInsetAdjustmentBehavior = .never
        // No rubber-banding and no pinch or double-tap zoom: this is an app, not a page.
        webView.scrollView.bounces = false
        webView.scrollView.bouncesZoom = false
        webView.scrollView.minimumZoomScale = 1
        webView.scrollView.maximumZoomScale = 1
        webView.scrollView.pinchGestureRecognizer?.isEnabled = false
        // A single-page app has no history, and an edge swipe must not leave it.
        webView.allowsBackForwardNavigationGestures = false
        #if DEBUG
        if #available(iOS 16.4, *) { webView.isInspectable = true }
        #endif
        view.addSubview(webView)

        midi.onPorts = { [weak self] inputs, outputs in
            self?.call("ports", [inputs.map(Self.json), outputs.map(Self.json)])
        }
        midi.onMessage = { [weak self] port, bytes in
            self?.call("receive", [port, bytes.map(Int.init)])
        }

        // Devices can be plugged in or paired (Bluetooth) while the app is in the background.
        NotificationCenter.default.addObserver(self, selector: #selector(appDidBecomeActive), name: UIApplication.didBecomeActiveNotification, object: nil)

        webView.load(URLRequest(url: WebFiles.home))
    }

    @objc private func appDidBecomeActive() {
        midi.refresh()
    }

    private static func json(_ port: MIDIBridge.PortInfo) -> [String: String] {
        ["id": port.id, "name": port.name, "manufacturer": port.manufacturer]
    }

    /// Calls window.__nativeMidi.<name>(...arguments) in the page.
    private func call(_ name: String, _ arguments: [Any]) {
        guard let data = try? JSONSerialization.data(withJSONObject: arguments), let text = String(data: data, encoding: .utf8) else { return }
        webView.evaluateJavaScript("window.__nativeMidi && window.__nativeMidi.\(name).apply(null, \(text))", completionHandler: nil)
    }

    // MARK: Messages from the page

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        if message.name == "log" {
            NSLog("[page] %@", String(describing: message.body))
            return
        }
        guard message.name == "midi", let body = message.body as? [String: Any], let type = body["type"] as? String else { return }
        switch type {
        case "start":
            midi.start()
        case "send":
            if let id = body["id"] as? String, let data = body["data"] as? [Int] {
                midi.send(to: id, bytes: data.map { UInt8(truncatingIfNeeded: $0) })
            }
        case "bluetooth":
            showBluetoothPairing()
        default:
            break
        }
    }

    /// Apple's Bluetooth MIDI pairing screen, in a Done-button navigation controller.
    private func showBluetoothPairing() {
        guard bluetoothSheet == nil, view.window != nil else { return }
        let central = CABTMIDICentralViewController()
        central.navigationItem.rightBarButtonItem = UIBarButtonItem(barButtonSystemItem: .done, target: self, action: #selector(closeBluetoothPairing))
        let nav = UINavigationController(rootViewController: central)
        nav.modalPresentationStyle = UIDevice.current.userInterfaceIdiom == .pad ? .formSheet : .pageSheet
        bluetoothSheet = nav
        topmostController().present(nav, animated: true)
    }

    @objc private func closeBluetoothPairing() {
        guard let sheet = bluetoothSheet else { return }
        sheet.dismiss(animated: true) { [weak self] in
            self?.bluetoothSheet = nil
            self?.midi.refresh()
        }
    }

    /// The controller that can present now: the top of the presented chain.
    private func topmostController() -> UIViewController {
        var top: UIViewController = self
        while let next = top.presentedViewController, !next.isBeingDismissed { top = next }
        return top
    }

    // MARK: Navigation

    func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        guard let url = action.request.url, let scheme = url.scheme?.lowercased() else { return decisionHandler(.cancel) }
        let isWeb = scheme == "http" || scheme == "https"
        let isMainFrame = action.targetFrame?.isMainFrame ?? true
        if action.shouldPerformDownload, Self.appSchemes.contains(scheme) || isWeb {
            return decisionHandler(.download)
        }
        if Self.appSchemes.contains(scheme) {
            return decisionHandler(.allow)
        }
        // Web links open in Safari. Anything else (file:, intent:, javascript:, custom schemes) is blocked.
        if isWeb && isMainFrame {
            UIApplication.shared.open(url)
        }
        decisionHandler(.cancel)
    }

    func webView(_ webView: WKWebView, decidePolicyFor navigationResponse: WKNavigationResponse, decisionHandler: @escaping (WKNavigationResponsePolicy) -> Void) {
        // Anything the web view cannot display is saved, not shown.
        decisionHandler(navigationResponse.canShowMIMEType ? .allow : .download)
    }

    func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration, for action: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
        if let url = action.request.url, url.scheme == "http" || url.scheme == "https" { UIApplication.shared.open(url) }
        return nil
    }

    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
        webView.reload()
    }

    /// The system asks once for the microphone (NSMicrophoneUsageDescription). Only the
    /// microphone is granted. Camera is refused: this app has no camera usage string,
    /// and asking for it would terminate the app.
    func webView(_ webView: WKWebView, requestMediaCapturePermissionFor origin: WKSecurityOrigin, initiatedByFrame frame: WKFrameInfo, type: WKMediaCaptureType, decisionHandler: @escaping (WKPermissionDecision) -> Void) {
        let ours = origin.protocol == WebFiles.scheme
        decisionHandler(ours && type == .microphone ? .grant : .deny)
    }

    // MARK: Page dialogs

    /// Dialogs are shown one at a time, in order. Each completion runs exactly once:
    /// with the answer, or with the fallback when no window can show the dialog.
    private var dialogQueue: [() -> Void] = []
    private var dialogOnScreen = false

    private func runDialog<Answer>(fallback: Answer, completion: @escaping (Answer) -> Void, build: @escaping (@escaping (Answer) -> Void) -> UIAlertController) {
        guard view.window != nil else { return completion(fallback) }
        dialogQueue.append { [self] in
            var answered = false
            let answer: (Answer) -> Void = { [self] value in
                guard !answered else { return }
                answered = true
                completion(value)
                self.dialogOnScreen = false
                self.showNextDialog()
            }
            let presenter = topmostController()
            guard presenter.view.window != nil else { return answer(fallback) }
            presenter.present(build(answer), animated: true)
        }
        showNextDialog()
    }

    private func showNextDialog() {
        guard !dialogOnScreen, !dialogQueue.isEmpty else { return }
        dialogOnScreen = true
        dialogQueue.removeFirst()()
    }

    func webView(_ webView: WKWebView, runJavaScriptAlertPanelWithMessage message: String, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping () -> Void) {
        runDialog(fallback: (), completion: { _ in completionHandler() }) { answer in
            let alert = UIAlertController(title: nil, message: message, preferredStyle: .alert)
            alert.addAction(UIAlertAction(title: "OK", style: .default) { _ in answer(()) })
            return alert
        }
    }

    func webView(_ webView: WKWebView, runJavaScriptConfirmPanelWithMessage message: String, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping (Bool) -> Void) {
        runDialog(fallback: false, completion: completionHandler) { answer in
            let alert = UIAlertController(title: nil, message: message, preferredStyle: .alert)
            alert.addAction(UIAlertAction(title: "Cancel", style: .cancel) { _ in answer(false) })
            alert.addAction(UIAlertAction(title: "OK", style: .default) { _ in answer(true) })
            return alert
        }
    }

    func webView(_ webView: WKWebView, runJavaScriptTextInputPanelWithPrompt prompt: String, defaultText: String?, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping (String?) -> Void) {
        runDialog(fallback: nil, completion: completionHandler) { answer in
            let alert = UIAlertController(title: nil, message: prompt, preferredStyle: .alert)
            alert.addTextField { $0.text = defaultText }
            alert.addAction(UIAlertAction(title: "Cancel", style: .cancel) { _ in answer(nil) })
            alert.addAction(UIAlertAction(title: "OK", style: .default) { [weak alert] _ in answer(alert?.textFields?.first?.text) })
            return alert
        }
    }

    // MARK: Saving files (lesson export)

    func webView(_ webView: WKWebView, navigationAction: WKNavigationAction, didBecome download: WKDownload) {
        download.delegate = self
    }

    func webView(_ webView: WKWebView, navigationResponse: WKNavigationResponse, didBecome download: WKDownload) {
        download.delegate = self
    }

    func download(_ download: WKDownload, decideDestinationUsing response: URLResponse, suggestedFilename: String, completionHandler: @escaping (URL?) -> Void) {
        // A fresh folder per download, so the name the page suggests cannot collide with another file.
        let folder = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString, isDirectory: true)
        do {
            try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        } catch {
            NSLog("[download] cannot create folder: %@", error.localizedDescription)
            return completionHandler(nil)
        }
        // Keep only the last path component, so a suggested name cannot point outside the folder.
        let name = URL(fileURLWithPath: suggestedFilename).lastPathComponent
        let file = folder.appendingPathComponent(name.isEmpty || name == "." || name == ".." ? "lesson.json" : name)
        downloads[ObjectIdentifier(download)] = file
        completionHandler(file)
    }

    func downloadDidFinish(_ download: WKDownload) {
        guard let file = downloads.removeValue(forKey: ObjectIdentifier(download)) else { return }
        let folder = file.deletingLastPathComponent()
        // Offer the usual choices: Save to Files, AirDrop, Messages and so on.
        let share = UIActivityViewController(activityItems: [file], applicationActivities: nil)
        // The temporary copy is removed when the share sheet closes, whatever the user chose.
        share.completionWithItemsHandler = { _, _, _, _ in
            try? FileManager.default.removeItem(at: folder)
        }
        if let popover = share.popoverPresentationController {
            popover.sourceView = view
            popover.sourceRect = CGRect(x: view.bounds.midX, y: view.bounds.midY, width: 1, height: 1)
            popover.permittedArrowDirections = []
        }
        topmostController().present(share, animated: true)
    }

    func download(_ download: WKDownload, didFailWithError error: Error, resumeData: Data?) {
        guard let file = downloads.removeValue(forKey: ObjectIdentifier(download)) else { return }
        try? FileManager.default.removeItem(at: file.deletingLastPathComponent())
        NSLog("[download] failed: %@", error.localizedDescription)
    }
}

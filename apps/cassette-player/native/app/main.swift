// Cassette Player — macOS .app shell (Chunk 2)
//
// A minimal menu-bar (accessory) app whose only job is lifecycle:
//   • on launch  → spawn the bundled supervisor (cassette-sidecar with
//     CASSETTE_SUPERVISE=1), which spawns Navidrome, waits for /ping, and
//     opens the UI;
//   • menu       → Open Cassette Player / Open Pairing & Status / Quit;
//   • on quit    → SIGTERM the supervisor, which tears Navidrome down too.
//
// All paths/secrets come from Resources/cassette.env (written by build-app.sh),
// so nothing machine-specific is compiled into this binary.

import Accelerate
import AVFoundation
import AppKit
import DiskArbitration
import Foundation
import MediaPlayer
import MediaToolbox
import Network
import SwiftUI

final class AppDelegate: NSObject, NSApplicationDelegate {
    var statusItem: NSStatusItem!
    var child: Process?
    var discWatcher: DiscWatcher?
    // Native Playback (Slice 1): the AVFoundation-backed player and the
    // loopback-only control server the Go sidecar calls to start playback.
    var player: Player?
    var playbackControl: PlaybackControlServer?
    // Now-playing card: a SwiftUI popover hung off the menu-bar icon. Left-click
    // toggles it; the existing dropdown moves to right-click (see menu below).
    var popover: NSPopover!
    var nowPlayingModel: NowPlayingModel?
    var menu: NSMenu!   // retained so right-click can pop it on demand
    let resourceDir = Bundle.main.resourcePath ?? "."
    private var sigtermSource: DispatchSourceSignal?

    func applicationDidFinishLaunching(_: Notification) {
        // Headless audio helper: the Tauri "Cassette" app spawns and reaps this
        // process (see the Rust reap_hub). There is no menu-bar item and no
        // supervisor here anymore - Cassette owns the sidecar + Navidrome
        // lifecycle now; this process is just the native engine + disc sensor +
        // macOS Now Playing / media keys.

        // Job 3: subscribe to Disk Arbitration so an inserted CD "comes to" the
        // sidecar instantly. The app stays a pure sensor — it tells the sidecar
        // to look (/api/rip/detect) or to reset (/api/rip/reset); all rip logic
        // stays in the sidecar. Plain HTTP to loopback works whether or not the
        // sidecar has a cert (the one-port listener serves both).
        discWatcher = DiscWatcher(sidecarBase: "http://127.0.0.1:5173")
        discWatcher?.start()

        // Native Playback (Slice 1): host the AVFoundation player + the
        // loopback control server. The Go sidecar (reached by the web remote on
        // :5173) POSTs /play here on 127.0.0.1:5174 to start audio. This is the
        // reverse of the DiscWatcher's Swift → Go path.
        let avPlayer = AVFoundationPlayer()
        player = avPlayer
        // The app hands the helper a fresh key each launch and the hub sends it
        // back on every call, so a web page reaching 5174 gets nowhere (BUG-777).
        let key = ProcessInfo.processInfo.environment["CASSETTE_LOCAL_KEY"]?
            .trimmingCharacters(in: .whitespaces) ?? ""
        let control = PlaybackControlServer(player: avPlayer, key: key)
        control.start(port: 5174)
        playbackControl = control

        installSigtermHandler()
    }

    // Tauri reaps this helper with SIGTERM (see reap_hub). Cocoa does NOT run
    // applicationWillTerminate on a raw SIGTERM, so trap it on a dispatch source
    // and terminate cleanly (which tears down AVFoundation + the listeners).
    private func installSigtermHandler() {
        signal(SIGTERM, SIG_IGN)   // hand SIGTERM to the source below, not the default
        let src = DispatchSource.makeSignalSource(signal: SIGTERM, queue: .main)
        src.setEventHandler { NSApp.terminate(nil) }
        src.resume()
        sigtermSource = src
    }

    // Left-click → toggle the now-playing popover; right-click / control-click →
    // show the dropdown menu. Implemented by inspecting the triggering event
    // rather than assigning statusItem.menu (which would make every click a menu).
    @objc func statusBarButtonClicked(_ sender: NSStatusBarButton) {
        let event = NSApp.currentEvent
        let isRightClick = event?.type == .rightMouseUp
            || event?.modifierFlags.contains(.control) == true
        if isRightClick {
            // Temporarily attach the menu so the click pops it, then detach so the
            // next left-click toggles the popover again.
            statusItem.menu = menu
            sender.performClick(nil)
            statusItem.menu = nil
        } else {
            togglePopover(sender)
        }
    }

    private func togglePopover(_ sender: NSStatusBarButton) {
        guard let popover = popover else { return }
        if popover.isShown {
            popover.performClose(sender)
        } else {
            // .maxY drops the popover from the BOTTOM of the menu-bar button so it
            // hangs directly below the icon with its arrow attached (bug #2).
            popover.show(relativeTo: sender.bounds, of: sender, preferredEdge: .maxY)
            // makeKey() lets the popover take the first click WITHOUT NSApp.activate
            // — full app activation kept the .transient popover from dismissing on
            // an outside click (bug #3). Transient + makeKey gives both.
            popover.contentViewController?.view.window?.makeKey()
        }
    }

    /// A small cassette glyph drawn as a template image (no bundled asset needed),
    /// so the menu bar tints it correctly in light and dark. Rounded body + two
    /// reels reads as a cassette at menu-bar size.
    static func cassetteStatusImage() -> NSImage {
        // The Cassette brand mark (apps/cassette/public/logo-mark.svg): rounded
        // cassette body, two reels, and the tape line above them. Drawn as a
        // template so the menu bar tints it for light/dark. The SVG is a 32-unit
        // viewBox; the mark occupies x:3–29, y:8–24 with a 2.2-unit stroke — mapped
        // proportionally into the image below (SVG y grows down, so p() flips it).
        let size = NSSize(width: 21, height: 14)
        let image = NSImage(size: size, flipped: false) { rect in
            let pad: CGFloat = 1.4
            let s = min((rect.width - 2 * pad) / 26.0, (rect.height - 2 * pad) / 16.0)
            let ox = rect.minX + (rect.width - 26 * s) / 2
            let oy = rect.minY + (rect.height - 16 * s) / 2
            func p(_ x: CGFloat, _ y: CGFloat) -> NSPoint {
                NSPoint(x: ox + (x - 3) * s, y: oy + (24 - y) * s)
            }
            let lw = 2.2 * s
            NSColor.black.setStroke()

            // Rounded cassette body: SVG rect x[3,29] y[8,24], corner radius 3.5.
            let body = NSBezierPath(
                roundedRect: NSRect(x: ox, y: oy, width: 26 * s, height: 16 * s),
                xRadius: 3.5 * s, yRadius: 3.5 * s)
            body.lineWidth = lw
            body.stroke()

            // Two reels at (11.5,16) and (20.5,16), radius 3.
            for cx in [CGFloat(11.5), 20.5] {
                let c = p(cx, 16)
                let r = 3.0 * s
                let reel = NSBezierPath(ovalIn: NSRect(x: c.x - r, y: c.y - r, width: 2 * r, height: 2 * r))
                reel.lineWidth = lw
                reel.stroke()
            }

            // Tape line above the reels (SVG y≈13.01, x 11.8→20.21).
            let line = NSBezierPath()
            line.move(to: p(11.8, 13.01))
            line.line(to: p(20.21, 13.01))
            line.lineWidth = lw
            line.lineCapStyle = .round
            line.stroke()
            return true
        }
        image.isTemplate = true
        return image
    }

    // Load Resources/cassette.env into a [String:String] (KEY=VALUE, # comments).
    func loadEnvFile() -> [String: String] {
        var out: [String: String] = [:]
        let path = (resourceDir as NSString).appendingPathComponent("cassette.env")
        guard let text = try? String(contentsOfFile: path, encoding: .utf8) else { return out }
        for raw in text.split(separator: "\n") {
            let line = raw.trimmingCharacters(in: .whitespaces)
            if line.isEmpty || line.hasPrefix("#") { continue }
            guard let eq = line.firstIndex(of: "=") else { continue }
            let k = String(line[..<eq]).trimmingCharacters(in: .whitespaces)
            var v = String(line[line.index(after: eq)...]).trimmingCharacters(in: .whitespaces)
            if v.count >= 2, v.hasPrefix("\""), v.hasSuffix("\"") { v = String(v.dropFirst().dropLast()) }
            out[k] = v
        }
        return out
    }

    func startSupervisor() {
        let res = resourceDir as NSString
        let sidecarBin = res.appendingPathComponent("cassette-sidecar")
        let navidromeBin = res.appendingPathComponent("navidrome")
        let ffmpegBin = res.appendingPathComponent("bin/ffmpeg")
        let mpvBin = res.appendingPathComponent("bin/mpv")

        var env = ProcessInfo.processInfo.environment
        for (k, v) in loadEnvFile() { env[k] = v }   // file overrides inherited
        env["CASSETTE_SUPERVISE"] = "1"
        env["CASSETTE_NAVIDROME_BIN"] = navidromeBin
        env["SIDECAR_BIND_ADDR"] = "127.0.0.1"
        // Bundled cert fallback: a freshly-installed .app serves HTTPS from the
        // cert baked into Resources/certs even before any data-dir cert exists.
        // The sidecar still prefers a data-dir cert (renewal without a rebuild).
        env["SIDECAR_BUNDLED_CERT_DIR"] = res.appendingPathComponent("certs")
        if FileManager.default.fileExists(atPath: ffmpegBin) { env["ND_FFMPEGPATH"] = ffmpegBin }
        if FileManager.default.fileExists(atPath: mpvBin) { env["ND_MPVPATH"] = mpvBin }
        // Bundled binaries first on PATH (cd-paranoia/flac in Chunk 3 land here too).
        env["PATH"] = res.appendingPathComponent("bin") + ":" + (env["PATH"] ?? "/usr/bin:/bin")

        // Logs → ~/Library/Logs/Cassette Player/
        let logDir = Self.diagnosticsLogDir
        try? FileManager.default.createDirectory(atPath: logDir, withIntermediateDirectories: true)
        let logPath = (logDir as NSString).appendingPathComponent("supervisor.log")
        // APPEND, never truncate — a relaunch (or the flagged crash loop) must NOT
        // wipe the prior run's tail, or a failing rip's per-track errors are lost
        // (the 2026-06-21 root cause). Rotate one generation when large.
        if let attrs = try? FileManager.default.attributesOfItem(atPath: logPath),
           let size = attrs[.size] as? UInt64, size > 5_000_000 {
            try? FileManager.default.removeItem(atPath: logPath + ".1")
            try? FileManager.default.moveItem(atPath: logPath, toPath: logPath + ".1")
        }
        if !FileManager.default.fileExists(atPath: logPath) {
            FileManager.default.createFile(atPath: logPath, contents: nil)
        }
        let logHandle = FileHandle(forWritingAtPath: logPath)
        logHandle?.seekToEndOfFile()

        let p = Process()
        p.executableURL = URL(fileURLWithPath: sidecarBin)
        p.environment = env
        if let lh = logHandle { p.standardOutput = lh; p.standardError = lh }
        p.terminationHandler = { _ in
            // Supervisor died on its own → nothing left to run; quit the shell.
            DispatchQueue.main.async { NSApp.terminate(nil) }
        }
        do {
            try p.run()
            child = p
        } catch {
            NSLog("Cassette Player: failed to launch supervisor: \(error)")
            NSApp.terminate(nil)
        }
    }

    // "Open Cassette Player" goes to the hosted Cassette dashboard — NEVER to
    // Navidrome's web UI on :4533. We use Navidrome's Subsonic engine, never its
    // frontend; putting a user on its login is a bug. Override with
    // CASSETTE_DASHBOARD_URL in cassette.env if the dashboard host changes.
    var dashboardURL: String {
        loadEnvFile()["CASSETTE_DASHBOARD_URL"] ?? "https://cassette.digital/dashboard/resume"
    }
    @objc func openUI() { NSWorkspace.shared.open(URL(string: dashboardURL)!) }
    // Pairing & first-run status — the sidecar's OWN page on :5173 (not Navidrome).
    @objc func openWizard() { NSWorkspace.shared.open(URL(string: "http://localhost:5173")!) }

    // ~/Library/Logs/Cassette Player/ — shared by the supervisor log writer
    // (startSupervisor) and the "Reveal Diagnostics" action, so one folder holds
    // every on-disk log: supervisor.log (Navidrome + sidecar stderr), the
    // sidecar's own sidecar.log/navidrome.log, and the Tauri shell's logs.
    static var diagnosticsLogDir: String {
        ("~/Library/Logs/Cassette Player" as NSString).expandingTildeInPath
    }

    // Opens the diagnostics log folder in Finder. v1 is REVEAL-ONLY: this agent
    // never uploads anything itself (the Go sidecar owns spine reporting). NOTE:
    // this agent's OWN crashes stay uncaptured — there is no NSException or POSIX
    // signal handler here, so a hard fault in this process leaves no report, only
    // whatever the OS writes to its own crash log.
    @objc func revealLogs() {
        let dir = Self.diagnosticsLogDir
        try? FileManager.default.createDirectory(atPath: dir, withIntermediateDirectories: true)
        NSWorkspace.shared.open(URL(fileURLWithPath: dir))
    }

    // "Send Feedback…" — the in-app replacement for a mailto affordance. Collects
    // a free-text message and has the SIDECAR emit a MANUAL user_feedback report
    // to the diagnostics spine (Feature B). The agent stays upload-free itself:
    // it only POSTs to the loopback sidecar, which owns all spine reporting. The
    // message ALWAYS sends regardless of the diagnostics opt-out (that flag gates
    // only auto crash/error telemetry).
    @objc func sendFeedback() {
        // Bring the accessory app forward so the modal sheet takes focus.
        NSApp.activate(ignoringOtherApps: true)

        let alert = NSAlert()
        alert.messageText = "Send Feedback"
        alert.informativeText = "Tell us what happened. This sends a short message to the Cassette team from this Mac."
        alert.addButton(withTitle: "Send")
        alert.addButton(withTitle: "Cancel")

        let field = NSTextView(frame: NSRect(x: 0, y: 0, width: 320, height: 96))
        field.font = .systemFont(ofSize: 13)
        field.isRichText = false
        let scroll = NSScrollView(frame: NSRect(x: 0, y: 0, width: 320, height: 96))
        scroll.documentView = field
        scroll.hasVerticalScroller = true
        scroll.borderType = .bezelBorder
        alert.accessoryView = scroll
        // Focus the text view when the sheet appears so the user can type at once.
        alert.window.initialFirstResponder = field

        guard alert.runModal() == .alertFirstButtonReturn else { return }
        let message = field.string.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !message.isEmpty else { return }
        postFeedback(message)
    }

    // POST the feedback to the sidecar loopback; the sidecar emits the spine
    // report. Shows a lightweight confirmation/failure alert on completion.
    private func postFeedback(_ message: String) {
        guard let url = URL(string: "http://127.0.0.1:5173/api/diagnostics/feedback"),
              let body = try? JSONSerialization.data(withJSONObject: ["message": message])
        else { return }
        var req = URLRequest(url: url)
        req.httpMethod = "POST"
        req.timeoutInterval = 20
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.httpBody = body
        URLSession.shared.dataTask(with: req) { _, resp, err in
            let ok = err == nil && ((resp as? HTTPURLResponse).map { (200..<300).contains($0.statusCode) } ?? false)
            DispatchQueue.main.async {
                let done = NSAlert()
                done.messageText = ok ? "Thanks for the feedback" : "Couldn't send feedback"
                done.informativeText = ok
                    ? "Your message was sent to the Cassette team."
                    : "We couldn't reach the local Cassette service. Please try again."
                done.addButton(withTitle: "OK")
                done.runModal()
            }
        }.resume()
    }

    @objc func quit() { NSApp.terminate(nil) }

    func applicationWillTerminate(_: Notification) {
        guard let c = child, c.isRunning, let pid = c.processIdentifier as Int32? else { return }
        kill(pid, SIGTERM)                 // supervisor traps this → stops Navidrome
        let deadline = Date().addingTimeInterval(8)
        while c.isRunning && Date() < deadline { usleep(100_000) }
        if c.isRunning { kill(pid, SIGKILL) }
    }
}

/// Watches for optical-disc insertion/removal via Disk Arbitration (Job 3).
///
/// The native app is a pure sensor: on a CD appearing it POSTs /api/rip/detect;
/// on disappearance, /api/rip/reset. It does NOT inspect the disc itself — the
/// sidecar owns cd-paranoia and decides audio-vs-data and what to match. We only
/// trigger on CD-shaped whole media; the sidecar's probe sorts out the rest.
final class DiscWatcher {
    private var session: DASession?
    private let sidecarBase: String

    init(sidecarBase: String) { self.sidecarBase = sidecarBase }

    func start() {
        guard let session = DASessionCreate(kCFAllocatorDefault) else {
            NSLog("Cassette Player: DASessionCreate failed; disc auto-detect disabled")
            return
        }
        self.session = session
        DASessionScheduleWithRunLoop(session, CFRunLoopGetMain(), CFRunLoopMode.defaultMode.rawValue)
        let ctx = Unmanaged.passUnretained(self).toOpaque()
        // Callbacks are @convention(c): the closures must not capture, so we
        // round-trip self through the context pointer. Registering also fires
        // for any disc ALREADY in the drive at launch — desirable.
        DARegisterDiskAppearedCallback(session, nil, { disk, context in
            DiscWatcher.from(context)?.handle(disk, appeared: true)
        }, ctx)
        DARegisterDiskDisappearedCallback(session, nil, { disk, context in
            DiscWatcher.from(context)?.handle(disk, appeared: false)
        }, ctx)
    }

    private static func from(_ ctx: UnsafeMutableRawPointer?) -> DiscWatcher? {
        guard let ctx = ctx else { return nil }
        return Unmanaged<DiscWatcher>.fromOpaque(ctx).takeUnretainedValue()
    }

    private func handle(_ disk: DADisk, appeared: Bool) {
        guard let desc = DADiskCopyDescription(disk) as? [String: Any] else { return }
        // Whole disk only — ignore per-track / volume entries that the AudioCD
        // filesystem also surfaces.
        guard (desc[kDADiskDescriptionMediaWholeKey as String] as? Bool) == true else { return }
        // Optical CD media kind is e.g. "IOCDMedia" (audio + data CDs). Match
        // anything CD-shaped; the sidecar decides if it's a rippable audio CD.
        let kind = (desc[kDADiskDescriptionMediaKindKey as String] as? String) ?? ""
        guard kind.localizedCaseInsensitiveContains("CD") else { return }
        // Hand the sidecar the disc's identity + presence directly. Disk Arbitration
        // is the same authoritative signal Finder/iTunes use, so the sidecar no longer
        // has to re-derive "is a disc in?" from a flaky cd-paranoia/drutil probe — and
        // it gets the BSD device for a reliable `diskutil eject`.
        let bsd = (desc[kDADiskDescriptionMediaBSDNameKey as String] as? String) ?? ""
        let vol = (desc[kDADiskDescriptionVolumePathKey as String] as? URL)?.path ?? ""
        notify(
            path: appeared ? "/api/rip/detect" : "/api/rip/reset",
            body: ["present": appeared, "bsdName": bsd, "volumePath": vol]
        )
    }

    private func notify(path: String, body: [String: Any]? = nil) {
        guard let url = URL(string: sidecarBase + path) else { return }
        var req = URLRequest(url: url)
        req.httpMethod = "POST"
        req.timeoutInterval = 10
        if let body = body, let data = try? JSONSerialization.data(withJSONObject: body) {
            req.setValue("application/json", forHTTPHeaderField: "Content-Type")
            req.httpBody = data
        }
        URLSession.shared.dataTask(with: req) { _, _, err in
            if let err = err {
                NSLog("Cassette Player: disc notify \(path) failed: \(err.localizedDescription)")
            }
        }.resume()
    }
}

// ─── Native Playback: the engine seam (SPEC Principle 1) ───────────────────────
//
// The Player engine (per platform) is the seam that lives on the Swift side:
// decode + output + OS media integration, behind a stable interface. Mac =
// AVFoundation. Slices 3–5 (and, later, Windows/Linux engines) implement this
// without touching the command channel.
//
// The Source seam (track id → playable URL) deliberately does NOT live here — it
// centralizes in the Go broker, which holds the Navidrome creds and is the shared,
// cross-platform layer (Slice 2). Swift stays a dumb player of whatever URL it is
// handed; for future engines, the broker + its Source are reused and only the
// engine swaps.

/// One resolved queue entry handed down by the broker: the playable URL plus the
/// metadata the engine needs for state reporting and system Now Playing. The
/// cred'd URL is never logged.
struct QueueItem {
    let trackId: String
    let url: URL
    let title: String
    let artist: String
    let album: String
    let durationSeconds: Double
}

/// Live snapshot the web polls (via Go) to drive the real transport bar.
struct PlaybackState {
    let currentTrackId: String?
    let positionSeconds: Double
    let durationSeconds: Double
    let isPlaying: Bool
    let queueIndex: Int
    let queueLength: Int
    /// The last few songs that could not play, oldest first. The hub polls /state,
    /// so this is how it learns of a failure, the same way it learns a song ended
    /// (the queue index moves on), and logs it with the song's file path (BUG-791).
    let failures: [PlaybackFailure]
}

/// One song AVFoundation could not open or that broke off mid-play. `seq` only
/// grows, so the hub logs each failure once however often it polls.
struct PlaybackFailure {
    let seq: Int
    let trackId: String
    let error: String
}

/// Player engine (per platform) — the seam. Mac = AVFoundation. Owns the queue,
/// transport, auto-advance, and state reporting; resolution stays in the broker.
protocol Player {
    func setQueue(_ items: [QueueItem], startIndex: Int, repeatMode: String)
    /// Replace everything after the current song, which keeps playing where it is (the
    /// desk's shuffle switch acting on what's playing). Empty clears what's next; with
    /// nothing loaded it does nothing.
    func setUpcoming(_ items: [QueueItem])
    func pausePlayback()
    func resumePlayback()
    func next()
    func prev()
    func seek(toSeconds seconds: Double)
    func setRepeat(_ mode: String)
    /// 0...1. No read-back path (see Go/web) — AVPlayer already owns the value,
    /// setVolume is the only writer, so nothing else needs to ask for it back.
    func setVolume(_ level: Double)
    func snapshot() -> PlaybackState
    /// A live audio-levels frame (spectrum + waveform + level) as JSON, for the
    /// visualizer feed. Empty frame until the tap delivers samples. Read off-main.
    func levelsJSON() -> String
    /// The currently-loaded queue entry (title/artist/album/id), or nil when idle.
    /// The now-playing card reads text from here — in-process, no network.
    func currentItem() -> QueueItem?
    /// The current track's cover, fetched once per track and cached. nil while it
    /// loads or when the track has no local art (card shows its placeholder).
    func currentArtwork() -> NSImage?
    /// Up to `limit` queue entries AFTER the current one, paired with their
    /// absolute queue index (so the card can jump straight to a row). In-process,
    /// no network — the card's "Up Next" list reads this.
    func upcoming(limit: Int) -> [(index: Int, item: QueueItem)]
    /// Jump straight to an absolute queue index and play it (row tap in Up Next).
    func playQueueIndex(_ index: Int)
}

/// AVFoundation-backed engine. A single AVPlayer plus a queue array + index,
/// auto-advancing on track end. (Gapless via AVQueuePlayer is a later refinement;
/// a single player keeps prev/seek/repeat-one unambiguously correct.) Outputs to
/// the default device — picking an AirPlay target at the OS level routes here.
/// Also drives macOS system Now Playing (Control Center / lock screen) and media
/// keys via MPNowPlayingInfoCenter + MPRemoteCommandCenter. Touch only on main.
final class AVFoundationPlayer: Player {
    private let player = AVPlayer()
    private var items: [QueueItem] = []
    private var index: Int = -1
    private var repeatMode: String = "off" // off | all | one
    private var endObserver: NSObjectProtocol?
    // A song AVFoundation can't decode, or that fails mid-play, never reaches its
    // end, so watching only the end stalled the queue with no trace (BUG-791). Its
    // status and its failed-to-play notice are watched too, and it moves the queue
    // on like an ended song.
    private var failObserver: NSObjectProtocol?
    private var statusObservation: NSKeyValueObservation?
    /// Bumped on every load and stop, so a late notice from a song already replaced
    /// never moves the queue, and one failure is handled once (the status and the
    /// notice can both fire for it).
    private var loadGeneration = 0
    /// Songs that failed one after another with none finishing in between. Once the
    /// whole queue has failed in a row the queue stops, rather than cycling through
    /// broken files forever on repeat.
    private var failuresInARow = 0
    private var failureSeq = 0
    private var failures: [PlaybackFailure] = []
    // Cover art, fetched once per ALBUM from the sidecar (Job 1). Cached so it
    // serves BOTH the now-playing card (currentArtwork) and macOS Control Center
    // (MPMediaItemPropertyArtwork) from a single request. Keyed by the album cover
    // identity, NOT the track: every track of an album shares one folder cover, so
    // a track change within an album keeps the same artwork — no clear-and-refetch
    // that blinks Control Center. Also guards a fetch in flight against the album
    // changing first.
    private var artwork: NSImage?
    private var artworkCoverKey: String?
    // Real-audio visualizer tap. Read-only PCM passthrough (see AudioLevels);
    // never modifies playback. Disable with CASSETTE_AUDIO_LEVELS=0.
    private let levels = AudioLevels()
    private let levelsEnabled = (ProcessInfo.processInfo.environment["CASSETTE_AUDIO_LEVELS"] ?? "1") != "0"

    init() { configureRemoteCommands() }

    // MARK: Player

    func setQueue(_ newItems: [QueueItem], startIndex: Int, repeatMode mode: String) {
        failuresInARow = 0
        items = newItems
        repeatMode = mode
        guard !items.isEmpty else { stop(); return }
        load(max(0, min(startIndex, items.count - 1)), autoplay: true)
    }

    func setUpcoming(_ newItems: [QueueItem]) {
        guard index >= 0, index < items.count else { return }
        items = Array(items[0...index]) + newItems
        updateNowPlaying()
    }

    func pausePlayback() { player.pause(); updateNowPlaying() }
    func resumePlayback() { if index >= 0 { player.play(); updateNowPlaying() } }
    func next() { failuresInARow = 0; advance(to: index + 1) }

    func prev() {
        failuresInARow = 0
        // >3s in (or already first) → restart current; otherwise step back.
        if currentSeconds() > 3 || index <= 0 {
            player.seek(to: .zero); player.play(); updateNowPlaying()
        } else {
            load(index - 1, autoplay: true)
        }
    }

    func seek(toSeconds seconds: Double) {
        player.seek(to: CMTime(seconds: max(0, seconds), preferredTimescale: 600)) { [weak self] _ in
            self?.updateNowPlaying()
        }
    }

    func setRepeat(_ mode: String) { repeatMode = mode }
    func setVolume(_ level: Double) { player.volume = Float(max(0, min(1, level))) }

    func snapshot() -> PlaybackState {
        let cur = (index >= 0 && index < items.count) ? items[index] : nil
        let playing = player.timeControlStatus == .playing || player.rate > 0
        return PlaybackState(
            currentTrackId: cur?.trackId,
            positionSeconds: currentSeconds(),
            durationSeconds: cur?.durationSeconds ?? 0,
            isPlaying: playing,
            queueIndex: index,
            queueLength: items.count,
            failures: failures
        )
    }

    func currentItem() -> QueueItem? {
        (index >= 0 && index < items.count) ? items[index] : nil
    }

    func currentArtwork() -> NSImage? { artwork }

    /// Live spectrum/waveform/level frame the web polls (via Go /levels). Read
    /// off-main — AudioLevels is internally locked — so it never blocks the engine.
    func levelsJSON() -> String { levels.snapshotJSON() }

    // Attach the read-only PCM tap to this item's audio track. Async because a
    // remote asset loads its tracks lazily. On ANY failure the item keeps its
    // default (nil) audioMix and plays exactly as before — the feed just stays idle.
    private func installLevelsTap(on item: AVPlayerItem, asset: AVURLAsset) {
        guard levelsEnabled else { return }
        let sink = levels
        // Whole install runs on the main actor: the AVFoundation objects are
        // main-confined, and this keeps them from crossing a concurrency boundary.
        Task { @MainActor in
            do {
                let tracks = try await asset.loadTracks(withMediaType: .audio)
                guard let track = tracks.first else {
                    NSLog("Cassette Player: levels — no audio track on item")
                    return
                }
                var callbacks = MTAudioProcessingTapCallbacks(
                    version: kMTAudioProcessingTapCallbacksVersion_0,
                    clientInfo: UnsafeMutableRawPointer(Unmanaged.passRetained(sink).toOpaque()),
                    init: levelsTapInit, finalize: levelsTapFinalize,
                    prepare: levelsTapPrepare, unprepare: levelsTapUnprepare, process: levelsTapProcess)
                var tap: MTAudioProcessingTap?
                let status = MTAudioProcessingTapCreate(
                    kCFAllocatorDefault, &callbacks,
                    kMTAudioProcessingTapCreationFlag_PostEffects, &tap)
                guard status == noErr, let processor = tap else {
                    NSLog("Cassette Player: levels — tap create failed (\(status))")
                    return
                }
                let params = AVMutableAudioMixInputParameters(track: track)
                params.audioTapProcessor = processor
                let mix = AVMutableAudioMix()
                mix.inputParameters = [params]
                item.audioMix = mix
                NSLog("Cassette Player: levels tap installed on audio track")
            } catch {
                NSLog("Cassette Player: levels — track load failed: \(error)")
            }
        }
    }

    func upcoming(limit: Int) -> [(index: Int, item: QueueItem)] {
        let start = max(index, -1) + 1
        guard start < items.count, limit > 0 else { return [] }
        let end = min(start + limit, items.count)
        return (start..<end).map { ($0, items[$0]) }
    }

    func playQueueIndex(_ idx: Int) {
        guard idx >= 0, idx < items.count else { return }
        failuresInARow = 0
        load(idx, autoplay: true)
    }

    // MARK: internals

    private func currentSeconds() -> Double {
        let t = player.currentTime().seconds
        return t.isFinite ? t : 0
    }

    private func load(_ idx: Int, autoplay: Bool) {
        guard idx >= 0, idx < items.count else { return }
        index = idx
        let asset = AVURLAsset(url: items[idx].url)
        let item = AVPlayerItem(asset: asset)
        player.replaceCurrentItem(with: item)
        installLevelsTap(on: item, asset: asset)
        loadGeneration += 1
        let generation = loadGeneration
        if let obs = endObserver { NotificationCenter.default.removeObserver(obs) }
        endObserver = NotificationCenter.default.addObserver(
            forName: .AVPlayerItemDidPlayToEndTime, object: item, queue: .main
        ) { [weak self] _ in self?.trackEnded() }
        // A file that can't be opened or decoded fails here, before it plays.
        statusObservation?.invalidate()
        statusObservation = item.observe(\.status, options: [.initial, .new]) { [weak self] item, _ in
            guard item.status == .failed else { return }
            let error = item.error
            DispatchQueue.main.async { self?.trackFailed(generation, error: error) }
        }
        // One that breaks off mid-play fails here.
        if let obs = failObserver { NotificationCenter.default.removeObserver(obs) }
        failObserver = NotificationCenter.default.addObserver(
            forName: .AVPlayerItemFailedToPlayToEndTime, object: item, queue: .main
        ) { [weak self] note in
            let error = note.userInfo?[AVPlayerItemFailedToPlayToEndTimeErrorKey] as? Error
            self?.trackFailed(generation, error: error)
        }
        if autoplay { player.play() }
        loadArtwork(for: items[idx])
        updateNowPlaying()
        NSLog("Cassette Player: playing queue item \(idx + 1)/\(items.count)")
    }

    // Fetch the track's cover from the sidecar (the single hub, Job 1) and cache
    // it for both the card and Control Center. Best-effort: a 404 / no-art track
    // simply leaves artwork nil and both surfaces show their placeholder.
    /// Album-level cover identity. Every track of an album shares one folder cover,
    /// so keying artwork by (artist, album) keeps it stable across a track change.
    private func coverKey(_ item: QueueItem) -> String { item.artist + "\u{1F}" + item.album }

    private func loadArtwork(for item: QueueItem) {
        let key = coverKey(item)
        // Same album cover as what is already showing — keep it. A track change WITHIN
        // an album must not clear + re-fetch the identical cover; that blinks Control
        // Center and the now-playing card (the same jank fixed on iOS/Android).
        if artworkCoverKey == key, artwork != nil { return }
        artwork = nil
        artworkCoverKey = key
        let trackId = item.trackId
        var comps = URLComponents(string: "http://127.0.0.1:5173/api/playback/cover")
        comps?.queryItems = [
            URLQueryItem(name: "trackId", value: trackId),
            URLQueryItem(name: "size", value: "600"),
        ]
        guard let url = comps?.url else { return }
        URLSession.shared.dataTask(with: url) { [weak self] data, resp, _ in
            guard let self = self,
                  let data = data,
                  (resp as? HTTPURLResponse)?.statusCode == 200,
                  let image = NSImage(data: data) else { return }
            DispatchQueue.main.async {
                // Drop the result if the album moved on while the fetch was in flight.
                guard self.artworkCoverKey == key,
                      let cur = self.currentItem(), self.coverKey(cur) == key else { return }
                self.artwork = image
                self.updateNowPlaying()   // re-publish with MPMediaItemPropertyArtwork
            }
        }.resume()
    }

    private func trackEnded() {
        failuresInARow = 0
        if repeatMode == "one" { player.seek(to: .zero); player.play(); return }
        advance(to: index + 1)
    }

    /// A song that could not play moves the queue on exactly as if it had ended,
    /// except that repeat-one skips it instead of retrying the same broken file
    /// forever. Logged here (stderr and the system log) and kept for the hub, which
    /// logs the song's file path in its own log (BUG-791).
    private func trackFailed(_ generation: Int, error: Error?) {
        guard generation == loadGeneration, index >= 0, index < items.count else { return }
        loadGeneration += 1 // handled: the other signal for this song is ignored
        let it = items[index]
        let reason = describePlaybackError(error, streamURL: it.url)
        NSLog("Cassette Player: could not play queue item \(index + 1)/\(items.count) \"\(it.title)\": \(reason)")
        failureSeq += 1
        failures.append(PlaybackFailure(seq: failureSeq, trackId: it.trackId, error: reason))
        if failures.count > 8 { failures.removeFirst(failures.count - 8) }
        failuresInARow += 1
        if failuresInARow >= items.count {
            NSLog("Cassette Player: every song in the queue failed in a row; stopping")
            failuresInARow = 0
            stop()
            return
        }
        advance(to: index + 1)
    }

    /// The error in a line: its description and its codes, and the underlying
    /// error's, which is where a decode failure says what went wrong. Never the
    /// whole error, whose details can carry the stream address and the password in
    /// it; the address is scrubbed from the description too, in case it appears.
    private func describePlaybackError(_ error: Error?, streamURL: URL) -> String {
        guard let ns = error as NSError? else { return "unknown error" }
        var out = "\(ns.localizedDescription) (\(ns.domain) \(ns.code))"
        if let under = ns.userInfo[NSUnderlyingErrorKey] as? NSError {
            out += ", caused by \(under.localizedDescription) (\(under.domain) \(under.code))"
        }
        if let query = streamURL.query, !query.isEmpty {
            out = out.replacingOccurrences(of: query, with: "…")
        }
        return out.replacingOccurrences(of: streamURL.absoluteString, with: "the stream")
    }

    private func advance(to ni: Int) {
        guard !items.isEmpty else { return }
        if ni >= items.count { repeatMode == "all" ? load(0, autoplay: true) : stop(); return }
        if ni < 0 { return }
        load(ni, autoplay: true)
    }

    private func stop() {
        loadGeneration += 1
        player.pause()
        player.replaceCurrentItem(with: nil)
        index = -1
        artwork = nil
        artworkCoverKey = nil
        updateNowPlaying()
    }

    // MARK: macOS system Now Playing + media keys

    private func configureRemoteCommands() {
        let c = MPRemoteCommandCenter.shared()
        c.playCommand.addTarget { [weak self] _ in self?.resumePlayback(); return .success }
        c.pauseCommand.addTarget { [weak self] _ in self?.pausePlayback(); return .success }
        c.togglePlayPauseCommand.addTarget { [weak self] _ in
            guard let self = self else { return .commandFailed }
            (self.player.rate > 0) ? self.pausePlayback() : self.resumePlayback()
            return .success
        }
        c.nextTrackCommand.addTarget { [weak self] _ in self?.next(); return .success }
        c.previousTrackCommand.addTarget { [weak self] _ in self?.prev(); return .success }
        c.changePlaybackPositionCommand.addTarget { [weak self] ev in
            guard let self = self, let e = ev as? MPChangePlaybackPositionCommandEvent else { return .commandFailed }
            self.seek(toSeconds: e.positionTime)
            return .success
        }
    }

    private func updateNowPlaying() {
        let center = MPNowPlayingInfoCenter.default()
        guard index >= 0, index < items.count else {
            center.nowPlayingInfo = nil
            center.playbackState = .stopped
            return
        }
        let it = items[index]
        var info: [String: Any] = [
            MPMediaItemPropertyTitle: it.title,
            MPMediaItemPropertyArtist: it.artist,
            MPMediaItemPropertyAlbumTitle: it.album,
            MPMediaItemPropertyPlaybackDuration: it.durationSeconds,
            MPNowPlayingInfoPropertyElapsedPlaybackTime: currentSeconds(),
            MPNowPlayingInfoPropertyPlaybackRate: Double(player.rate),
        ]
        // Carry the cached cover so pause/resume/seek (which rebuild this dict)
        // don't drop the Control Center artwork once it has loaded.
        if let art = artwork, artworkCoverKey == coverKey(it) {
            info[MPMediaItemPropertyArtwork] = MPMediaItemArtwork(boundsSize: art.size) { _ in art }
        }
        center.nowPlayingInfo = info
        center.playbackState = (player.rate > 0) ? .playing : .paused
    }
}

// ─── Now-playing card (SwiftUI popover) ────────────────────────────────────────
//
// The card runs in the same process as the engine, so it reads state and drives
// transport directly — no HTTP for control. The only network call is the cover
// (Job 1), and even that is owned by the engine (one fetch per track, cached and
// surfaced via currentArtwork). The model is a thin polling view of the engine.

/// One row in the Up Next list. `id` is the track's ABSOLUTE queue index — stable
/// for SwiftUI and the jump target a row tap plays.
struct UpNextRow: Identifiable {
    let id: Int
    let title: String
    let artist: String
    let durationSeconds: Double
}

/// A playlist the card can add the current track to (from the cloud, via the
/// sidecar). `id` is the cloud playlist UUID.
struct CardPlaylist: Identifiable {
    let id: String
    let name: String
}

/// Observable mirror of the engine the SwiftUI card binds to. Polls on a light
/// timer while the popover is open (start/stop driven by the view's lifecycle).
final class NowPlayingModel: ObservableObject {
    @Published var hasTrack = false
    @Published var title = ""
    @Published var artist = ""
    @Published var isPlaying = false
    @Published var positionSeconds: Double = 0
    @Published var durationSeconds: Double = 0
    @Published var artwork: NSImage?
    /// True while the user drags the scrubber, so the poll doesn't yank the thumb
    /// back to the engine's (pre-seek) position mid-drag.
    @Published var isScrubbing = false
    /// The next few queue items (display-capped); rows tap-to-jump.
    @Published var upNext: [UpNextRow] = []
    /// Total upcoming count (may exceed the displayed rows) for the header.
    @Published var upcomingCount = 0

    // Quick actions (favorite + add-to-playlist) — these talk to the CLOUD via
    // the sidecar loopback, the same store the web dashboard reads. Not Subsonic.
    /// Whether the current track is in the user's (cloud) Favorites.
    @Published var favorited = false
    /// Whether the device is signed in to the cloud — gates (dims) both actions.
    @Published var actionsAuthed = false
    /// The user's playlists, for the add-to-playlist picker.
    @Published var playlists: [CardPlaylist] = []
    /// Transient confirmation line (e.g. "Added to Chillax").
    @Published var toast: String?

    /// Footer actions, supplied by the AppDelegate (it owns the URL-open / quit
    /// logic). The card stays a pure view; these are the way "into" Cassette.
    var onOpenCassette: (() -> Void)?
    var onOpenPairing: (() -> Void)?
    var onRevealLogs: (() -> Void)?
    var onSendFeedback: (() -> Void)?
    var onQuit: (() -> Void)?

    private let player: Player
    private var timer: Timer?
    private let upNextLimit = 5
    /// The track whose favorite state we've loaded — refetch only on change.
    private var favoriteTrackId: String?
    private var toastClearWork: DispatchWorkItem?
    private let sidecarBase = "http://127.0.0.1:5173"

    init(player: Player) { self.player = player }

    func start() {
        refresh()
        loadPlaylists()   // for the add-to-playlist picker; also sets actionsAuthed
        let t = Timer(timeInterval: 0.5, repeats: true) { [weak self] _ in self?.refresh() }
        RunLoop.main.add(t, forMode: .common)   // keep ticking during menu/scroll tracking
        timer = t
    }

    func stop() {
        timer?.invalidate()
        timer = nil
    }

    private func refresh() {
        let snap = player.snapshot()
        let item = player.currentItem()
        hasTrack = item != nil
        title = item?.title ?? ""
        artist = item?.artist ?? ""
        isPlaying = snap.isPlaying
        durationSeconds = snap.durationSeconds
        if !isScrubbing { positionSeconds = snap.positionSeconds }
        artwork = player.currentArtwork()
        upNext = player.upcoming(limit: upNextLimit).map {
            UpNextRow(id: $0.index, title: $0.item.title,
                      artist: $0.item.artist, durationSeconds: $0.item.durationSeconds)
        }
        upcomingCount = max(0, snap.queueLength - max(snap.queueIndex, -1) - 1)
        // Refetch favorite state once per track change (keyed on id, like the cover).
        if item?.trackId != favoriteTrackId {
            favoriteTrackId = item?.trackId
            favorited = false
            if item != nil { refreshFavorite() }
        }
    }

    func togglePlayPause() {
        isPlaying ? player.pausePlayback() : player.resumePlayback()
        refresh()
    }
    func next() { player.next(); refresh() }
    func prev() { player.prev(); refresh() }
    func seek(to seconds: Double) {
        player.seek(toSeconds: seconds)
        positionSeconds = seconds
    }
    func jump(to index: Int) { player.playQueueIndex(index); refresh() }

    // MARK: Quick actions (favorite + add-to-playlist) — cloud via the sidecar

    private func sidecarURL(_ path: String) -> URL? { URL(string: sidecarBase + path) }

    private func refreshFavorite() {
        guard let url = sidecarURL("/api/playback/favorite") else { return }
        URLSession.shared.dataTask(with: url) { [weak self] data, _, _ in
            guard let self, let data,
                  let s = try? JSONDecoder().decode(FavoriteStatus.self, from: data) else { return }
            DispatchQueue.main.async {
                self.actionsAuthed = s.authed
                self.favorited = s.favorited
            }
        }.resume()
    }

    /// Optimistic toggle: flip instantly, then write to the cloud; revert on failure.
    func toggleFavorite() {
        guard hasTrack, actionsAuthed, let url = sidecarURL("/api/playback/favorite") else { return }
        let target = !favorited
        favorited = target
        var req = URLRequest(url: url)
        req.httpMethod = target ? "POST" : "DELETE"
        URLSession.shared.dataTask(with: req) { [weak self] _, resp, _ in
            guard let self else { return }
            if !Self.ok(resp) {
                DispatchQueue.main.async { self.favorited = !target }   // revert
            }
        }.resume()
    }

    func loadPlaylists() {
        guard let url = sidecarURL("/api/playback/playlists") else { return }
        URLSession.shared.dataTask(with: url) { [weak self] data, _, _ in
            guard let self, let data,
                  let r = try? JSONDecoder().decode(PlaylistsResponse.self, from: data) else { return }
            DispatchQueue.main.async {
                self.actionsAuthed = r.authed
                self.playlists = r.playlists.map { CardPlaylist(id: $0.id, name: $0.name) }
            }
        }.resume()
    }

    func add(toPlaylist id: String, name: String) {
        guard hasTrack,
              let encoded = id.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed),
              let url = sidecarURL("/api/playback/playlists/\(encoded)/add") else { return }
        var req = URLRequest(url: url)
        req.httpMethod = "POST"
        URLSession.shared.dataTask(with: req) { [weak self] _, resp, _ in
            guard let self else { return }
            DispatchQueue.main.async {
                self.showToast(Self.ok(resp) ? "Added to \(name)" : "Couldn't add")
            }
        }.resume()
    }

    private func showToast(_ message: String) {
        toast = message
        toastClearWork?.cancel()
        let work = DispatchWorkItem { [weak self] in self?.toast = nil }
        toastClearWork = work
        DispatchQueue.main.asyncAfter(deadline: .now() + 1.8, execute: work)
    }

    private static func ok(_ resp: URLResponse?) -> Bool {
        (resp as? HTTPURLResponse).map { (200..<300).contains($0.statusCode) } ?? false
    }

    private struct FavoriteStatus: Decodable { let authed: Bool; let favorited: Bool }
    private struct PlaylistsResponse: Decodable {
        let authed: Bool
        let playlists: [Item]
        struct Item: Decodable { let id: String; let name: String }
    }
}

/// The card: a self-sufficient Cassette control surface — a compact now-playing
/// strip (everything macOS Now Playing does), the Up Next queue (what it can't),
/// and a footer into Cassette. System materials + default animation for Apple's
/// polish; grounded with the Cassette amber. Popover-sized, not a window.
struct NowPlayingView: View {
    @ObservedObject var model: NowPlayingModel
    private let amber = Color(red: 0xE8 / 255, green: 0x50 / 255, blue: 0x0A / 255)
    private let artSize: CGFloat = 80

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            nowPlayingStrip
            scrubber
            transport
            if !model.upNext.isEmpty {
                Divider()
                upNextSection
            }
            Divider()
            footer
        }
        .padding(16)
        .frame(width: 320)
        .overlay(alignment: .bottom) {
            if let toast = model.toast {
                Text(toast)
                    .font(.caption.weight(.medium))
                    .padding(.horizontal, 12)
                    .padding(.vertical, 6)
                    .background(.thinMaterial, in: Capsule())
                    .overlay(Capsule().strokeBorder(.white.opacity(0.08)))
                    .padding(.bottom, 10)
                    .transition(.opacity)
            }
        }
        .animation(.default, value: model.toast)
        .onAppear { model.start() }
        .onDisappear { model.stop() }
    }

    // ── A. Now-playing strip: art + title/artist + quick actions ───────────────
    private var nowPlayingStrip: some View {
        HStack(spacing: 12) {
            cover
            VStack(alignment: .leading, spacing: 3) {
                Text(model.hasTrack ? model.title : "Nothing playing")
                    .font(.headline)
                    .lineLimit(2)
                    .truncationMode(.tail)
                    .fixedSize(horizontal: false, vertical: true)
                Text(model.hasTrack ? model.artist : "—")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
                    .truncationMode(.tail)
            }
            Spacer(minLength: 8)
            trackActions
        }
    }

    // Heart (favorite) + add-to-playlist, dimmed when not signed in to the cloud.
    private var trackActions: some View {
        let enabled = model.hasTrack && model.actionsAuthed
        return VStack(spacing: 12) {
            Button { model.toggleFavorite() } label: {
                Image(systemName: model.favorited ? "heart.fill" : "heart")
                    .font(.system(size: 17))
                    .foregroundStyle(model.favorited ? amber : Color.secondary)
                    .frame(width: 28, height: 24)
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .help(model.favorited ? "Remove from Favorites" : "Add to Favorites")

            Menu {
                if model.playlists.isEmpty {
                    Text("No playlists")
                } else {
                    ForEach(model.playlists) { pl in
                        Button(pl.name) { model.add(toPlaylist: pl.id, name: pl.name) }
                    }
                }
            } label: {
                Image(systemName: "text.badge.plus")
                    .font(.system(size: 16))
                    .foregroundStyle(.secondary)
                    .frame(width: 28, height: 24)
                    .contentShape(Rectangle())
            }
            .menuStyle(.borderlessButton)
            .menuIndicator(.hidden)
            .fixedSize()
            .help("Add to a playlist")
        }
        .disabled(!enabled)
        .opacity(enabled ? 1 : 0.4)
    }

    private var cover: some View {
        ZStack {
            // Calm gradient placeholder — shown while loading or when a track has
            // no local art. Never a broken-image glyph.
            RoundedRectangle(cornerRadius: 10, style: .continuous)
                .fill(LinearGradient(
                    colors: [Color(white: 0.30), Color(white: 0.15)],
                    startPoint: .topLeading, endPoint: .bottomTrailing))
            if let art = model.artwork {
                Image(nsImage: art)
                    .resizable()
                    .aspectRatio(contentMode: .fill)
            } else {
                Image(systemName: "music.note")
                    .font(.system(size: 24, weight: .light))
                    .foregroundStyle(.white.opacity(0.45))
            }
        }
        .frame(width: artSize, height: artSize)
        .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
        .shadow(color: .black.opacity(0.22), radius: 6, y: 3)
    }

    private var scrubber: some View {
        let span = max(model.durationSeconds, 0.1)
        return VStack(spacing: 3) {
            Slider(
                value: Binding(
                    get: { min(model.positionSeconds, span) },
                    set: { model.positionSeconds = $0 }
                ),
                in: 0 ... span,
                onEditingChanged: { editing in
                    model.isScrubbing = editing
                    if !editing { model.seek(to: model.positionSeconds) }
                }
            )
            .tint(amber)
            .disabled(!model.hasTrack || model.durationSeconds <= 0)
            HStack {
                Text(Self.clock(model.positionSeconds))
                Spacer()
                Text(Self.clock(model.durationSeconds))
            }
            .font(.caption2.monospacedDigit())
            .foregroundStyle(.secondary)
        }
    }

    private var transport: some View {
        HStack(spacing: 34) {
            transportButton("backward.fill", size: 20, action: model.prev)
            transportButton(model.isPlaying ? "pause.fill" : "play.fill",
                            size: 28, tint: amber, action: model.togglePlayPause)
            transportButton("forward.fill", size: 20, action: model.next)
        }
        .frame(maxWidth: .infinity)   // center within the leading-aligned stack
        .disabled(!model.hasTrack)
    }

    private func transportButton(_ symbol: String, size: CGFloat, tint: Color? = nil,
                                 action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Image(systemName: symbol)
                .font(.system(size: size))
                .foregroundStyle(tint ?? .primary)
                .frame(width: size + 16, height: size + 16)   // generous hit target
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }

    // ── B. Up Next: the next few queue items; rows tap-to-jump ─────────────────
    private var upNextSection: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack {
                Text("Up Next")
                    .font(.caption.weight(.semibold))
                    .textCase(.uppercase)
                    .foregroundStyle(.secondary)
                Spacer()
                Text("Queue (\(model.upcomingCount))")
                    .font(.caption2)
                    .foregroundStyle(.tertiary)
            }
            ForEach(model.upNext) { row in
                Button { model.jump(to: row.id) } label: {
                    HStack(spacing: 8) {
                        VStack(alignment: .leading, spacing: 1) {
                            Text(row.title)
                                .font(.callout)
                                .lineLimit(1)
                                .truncationMode(.tail)
                            Text(row.artist)
                                .font(.caption2)
                                .foregroundStyle(.secondary)
                                .lineLimit(1)
                                .truncationMode(.tail)
                        }
                        Spacer(minLength: 8)
                        Text(Self.clock(row.durationSeconds))
                            .font(.caption2.monospacedDigit())
                            .foregroundStyle(.secondary)
                    }
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
            }
        }
    }

    // ── C. Footer: Open Cassette + overflow (Pairing & Status, Quit) ──────────
    private var footer: some View {
        HStack {
            Button { model.onOpenCassette?() } label: {
                HStack(spacing: 6) {
                    Image(systemName: "arrow.up.forward")
                    Text("Open Cassette")
                }
                .font(.callout)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            Spacer()
            Menu {
                Button("Pairing & Status") { model.onOpenPairing?() }
                Button("Reveal Diagnostics") { model.onRevealLogs?() }
                Button("Send Feedback…") { model.onSendFeedback?() }
                Divider()
                Button("Quit Cassette Player") { model.onQuit?() }
            } label: {
                Image(systemName: "ellipsis")
                    .font(.system(size: 15, weight: .semibold))
                    .frame(width: 30, height: 22)
                    .contentShape(Rectangle())
            }
            .menuStyle(.borderlessButton)
            .menuIndicator(.hidden)
            .fixedSize()
        }
        .foregroundStyle(.primary)
    }

    private static func clock(_ seconds: Double) -> String {
        guard seconds.isFinite, seconds >= 0 else { return "0:00" }
        let total = Int(seconds)
        return String(format: "%d:%02d", total / 60, total % 60)
    }
}

// ─── Real-audio visualizer tap (MTAudioProcessingTap → vDSP FFT → /levels) ─────
//
// AVPlayer has no installTap (that's AVAudioEngine-only), so we tap decoded PCM
// with an MTAudioProcessingTap on the player item's audioMix. The tap is a
// read-only PostEffects passthrough: it copies samples into a ring buffer and
// never alters the audio, so playback is unaffected whether or not anyone is
// watching. The audio thread only does a cheap copy; the FFT runs lazily when the
// web asks for /levels, off the audio thread, so the render callback stays light.
//
// @unchecked Sendable: the instance is shared between the audio thread (writer)
// and the control-server thread (reader); the NSLock makes that access safe.
final class AudioLevels: @unchecked Sendable {
    static let binCount = 64
    static let waveCount = 128
    static let fftSize = 1024

    private let lock = NSLock()
    private var ring = [Float](repeating: 0, count: AudioLevels.fftSize)
    private var writeIdx = 0
    private var everWrote = false

    private let log2n: vDSP_Length
    private let setup: FFTSetup
    private var window = [Float](repeating: 0, count: AudioLevels.fftSize)

    init() {
        log2n = vDSP_Length(log2(Float(AudioLevels.fftSize)))
        setup = vDSP_create_fftsetup(log2n, FFTRadix(kFFTRadix2))!
        vDSP_hann_window(&window, vDSP_Length(AudioLevels.fftSize), Int32(vDSP_HANN_NORM))
    }
    deinit { vDSP_destroy_fftsetup(setup) }

    /// Audio thread: copy incoming mono samples into the ring. Cheap by design.
    func write(_ ptr: UnsafePointer<Float>, count: Int) {
        let n = AudioLevels.fftSize
        lock.lock()
        for i in 0..<count {
            ring[writeIdx] = ptr[i]
            writeIdx += 1
            if writeIdx >= n { writeIdx = 0 }
        }
        everWrote = true
        lock.unlock()
    }

    /// Control-server thread: FFT the ring into a compact JSON frame.
    func snapshotJSON() -> String {
        let n = AudioLevels.fftSize
        var samples = [Float](repeating: 0, count: n)
        lock.lock()
        let wpos = writeIdx
        let wrote = everWrote
        for i in 0..<n { samples[i] = ring[(wpos + i) % n] } // oldest → newest
        lock.unlock()
        if !wrote { return #"{"bins":[],"wave":[],"level":0}"# }

        var rms: Float = 0
        vDSP_rmsqv(samples, 1, &rms, vDSP_Length(n))
        let level = min(1, rms * 4)

        let waveCount = AudioLevels.waveCount
        var wave = [Float](repeating: 0, count: waveCount)
        let step = max(1, n / waveCount)
        for i in 0..<waveCount {
            let idx = n - waveCount * step + i * step
            wave[i] = max(-1, min(1, samples[max(0, min(n - 1, idx))]))
        }

        var windowed = [Float](repeating: 0, count: n)
        vDSP_vmul(samples, 1, window, 1, &windowed, 1, vDSP_Length(n))

        let half = n / 2
        var realp = [Float](repeating: 0, count: half)
        var imagp = [Float](repeating: 0, count: half)
        var mags = [Float](repeating: 0, count: half)
        windowed.withUnsafeBufferPointer { wp in
            wp.baseAddress!.withMemoryRebound(to: DSPComplex.self, capacity: half) { cp in
                realp.withUnsafeMutableBufferPointer { rp in
                    imagp.withUnsafeMutableBufferPointer { ip in
                        var split = DSPSplitComplex(realp: rp.baseAddress!, imagp: ip.baseAddress!)
                        vDSP_ctoz(cp, 2, &split, 1, vDSP_Length(half))
                        vDSP_fft_zrip(setup, &split, 1, log2n, FFTDirection(FFT_FORWARD))
                        vDSP_zvmags(&split, 1, &mags, 1, vDSP_Length(half))
                    }
                }
            }
        }

        var bins = [Float](repeating: 0, count: AudioLevels.binCount)
        let usable = Int(Float(half) * 0.85)
        for b in 0..<AudioLevels.binCount {
            let lo = Int(powf(Float(b) / Float(AudioLevels.binCount), 1.7) * Float(usable))
            let hi = max(lo + 1, Int(powf(Float(b + 1) / Float(AudioLevels.binCount), 1.7) * Float(usable)))
            var sum: Float = 0
            var c = 0
            var k = lo
            while k < hi && k < half { sum += mags[k]; c += 1; k += 1 }
            let m = c > 0 ? sum / Float(c) : 0
            bins[b] = min(1, sqrtf(m) / Float(n) * 18)
        }

        var out = #"{"bins":["#
        for (i, v) in bins.enumerated() { if i > 0 { out += "," }; out += String(format: "%.3f", v) }
        out += #"],"wave":["#
        for (i, v) in wave.enumerated() { if i > 0 { out += "," }; out += String(format: "%.3f", v) }
        out += #"],"level":"# + String(format: "%.3f", level) + "}"
        return out
    }
}

// MTAudioProcessingTap C callbacks — top-level (no capture) so they convert to the
// @convention(c) function pointers the tap struct wants. They reach the shared
// AudioLevels through the tap's storage (set from clientInfo at init).

private func levelsTapInit(_ tap: MTAudioProcessingTap, _ clientInfo: UnsafeMutableRawPointer?, _ tapStorageOut: UnsafeMutablePointer<UnsafeMutableRawPointer?>) {
    tapStorageOut.pointee = clientInfo
}
private func levelsTapFinalize(_ tap: MTAudioProcessingTap) {
    let storage = MTAudioProcessingTapGetStorage(tap)
    Unmanaged<AudioLevels>.fromOpaque(storage).release()
}
private func levelsTapPrepare(_ tap: MTAudioProcessingTap, _ maxFrames: CMItemCount, _ format: UnsafePointer<AudioStreamBasicDescription>) {}
private func levelsTapUnprepare(_ tap: MTAudioProcessingTap) {}
private func levelsTapProcess(_ tap: MTAudioProcessingTap, _ numberFrames: CMItemCount, _ flags: MTAudioProcessingTapFlags, _ bufferListInOut: UnsafeMutablePointer<AudioBufferList>, _ numberFramesOut: UnsafeMutablePointer<CMItemCount>, _ flagsOut: UnsafeMutablePointer<MTAudioProcessingTapFlags>) {
    let status = MTAudioProcessingTapGetSourceAudio(tap, numberFrames, bufferListInOut, flagsOut, nil, numberFramesOut)
    guard status == noErr else { return }
    let storage = MTAudioProcessingTapGetStorage(tap)
    let sink = Unmanaged<AudioLevels>.fromOpaque(storage).takeUnretainedValue()
    let abl = UnsafeMutableAudioBufferListPointer(bufferListInOut)
    guard let buffer = abl.first, let mData = buffer.mData else { return }
    let frames = Int(numberFramesOut.pointee)
    sink.write(mData.assumingMemoryBound(to: Float.self), count: frames)
}

// ─── Loopback playback control server (Slice 1 IPC: Go → Swift) ────────────────
//
// A minimal HTTP/1.1 server on 127.0.0.1:5174 (Network.framework, no third-party
// deps) exposing POST /play {"url": "..."}. The Go sidecar calls it after the web
// remote sends a play command. Loopback-bound by construction; never reachable off
// the machine.
//
// Loopback is not enough on its own: any web page in the person's browser can
// reach 127.0.0.1 (BUG-777). So a request must name this address as its Host
// (a DNS-rebinding page names its own), carry no Origin (browsers add one to
// every cross-site POST; the hub never does), and carry the launch key the app
// gave both the hub and this helper. Only songs on this computer play.
final class PlaybackControlServer {
    private let player: Player
    private let key: String
    private var listener: NWListener?
    private let queue = DispatchQueue(label: "digital.cassette.playback.control")

    /// Headers past this, or a body past maxBody, end the connection.
    private let maxHeader = 16 * 1024
    private let maxBody = 1024 * 1024

    init(player: Player, key: String) {
        self.player = player
        self.key = key
    }

    func start(port: UInt16) {
        let params = NWParameters.tcp
        params.allowLocalEndpointReuse = true
        // Bind to loopback only — the control channel must never be exposed.
        params.requiredLocalEndpoint = .hostPort(
            host: "127.0.0.1", port: NWEndpoint.Port(rawValue: port) ?? 5174
        )
        do {
            let l = try NWListener(using: params)
            listener = l
            l.newConnectionHandler = { [weak self] conn in self?.accept(conn) }
            l.start(queue: queue)
            NSLog("Cassette Player: playback control server listening on 127.0.0.1:\(port)")
        } catch {
            NSLog("Cassette Player: playback control server failed to start: \(error)")
        }
    }

    private func accept(_ conn: NWConnection) {
        conn.start(queue: queue)
        // A caller that never finishes its request doesn't get to hold a connection.
        queue.asyncAfter(deadline: .now() + 10) { conn.cancel() }
        receive(conn, buffer: Data())
    }

    // Accumulate until a full request (headers + Content-Length body) is parsed.
    private func receive(_ conn: NWConnection, buffer: Data) {
        conn.receive(minimumIncompleteLength: 1, maximumLength: 64 * 1024) { [weak self] data, _, isComplete, error in
            guard let self = self else { return }
            var acc = buffer
            if let data = data { acc.append(data) }
            switch self.parse(acc) {
            case .ready(let req):
                self.process(req, on: conn)
                return
            case .bad:
                self.respond(conn, status: "400 Bad Request", body: #"{"ok":false}"#)
                return
            case .needMore:
                break
            }
            if isComplete || error != nil {
                self.respond(conn, status: "400 Bad Request", body: #"{"ok":false}"#)
                return
            }
            self.receive(conn, buffer: acc)
        }
    }

    private struct Request {
        let method: String
        let path: String
        let headers: [String: String] // names lowercased
        let body: Data
    }

    private enum Parsed { case needMore, bad, ready(Request) }

    // A Request once the full body has arrived; bad for anything malformed or too big.
    private func parse(_ data: Data) -> Parsed {
        guard let sep = data.range(of: Data("\r\n\r\n".utf8)) else {
            return data.count > maxHeader ? .bad : .needMore
        }
        if data.distance(from: data.startIndex, to: sep.lowerBound) > maxHeader { return .bad }
        let headerData = data.subdata(in: data.startIndex..<sep.lowerBound)
        guard let headerText = String(data: headerData, encoding: .utf8) else { return .bad }
        let lines = headerText.components(separatedBy: "\r\n")
        let parts = (lines.first ?? "").split(separator: " ")
        guard parts.count >= 2 else { return .bad }
        var headers: [String: String] = [:]
        for line in lines.dropFirst() {
            guard let colon = line.firstIndex(of: ":") else { continue }
            let name = line[..<colon].trimmingCharacters(in: .whitespaces).lowercased()
            headers[name] = line[line.index(after: colon)...].trimmingCharacters(in: .whitespaces)
        }
        var contentLength = 0
        if let v = headers["content-length"] {
            guard let n = Int(v), n >= 0, n <= maxBody else { return .bad }
            contentLength = n
        }
        let available = data.distance(from: sep.upperBound, to: data.endIndex)
        if available < contentLength { return .needMore }
        let bodyEnd = data.index(sep.upperBound, offsetBy: contentLength)
        return .ready(Request(method: String(parts[0]), path: String(parts[1]), headers: headers,
                              body: data.subdata(in: sep.upperBound..<bodyEnd)))
    }

    /// Whether the request came from the hub on this computer (see the class note).
    private func fromHub(_ req: Request) -> Bool {
        let host = (req.headers["host"] ?? "").lowercased()
        guard host == "127.0.0.1:5174" || host == "localhost:5174" else { return false }
        if req.headers["origin"] != nil { return false }
        if key.isEmpty { return true } // a hand-run dev helper: no app is handing out keys
        guard let got = req.headers["x-cassette-local-key"] else { return false }
        // Same length and every byte compared, so timing says nothing about the key.
        let a = Array(got.utf8), b = Array(key.utf8)
        guard a.count == b.count else { return false }
        return zip(a, b).reduce(0) { $0 | ($1.0 ^ $1.1) } == 0
    }

    /// Only songs streamed from this computer play, never an address a caller made up.
    private static func isLocal(_ url: URL) -> Bool {
        guard url.scheme == "http", let host = url.host?.lowercased() else { return false }
        return host == "127.0.0.1" || host == "localhost" || host == "::1"
    }

    private func process(_ req: Request, on conn: NWConnection) {
        guard fromHub(req) else {
            respond(conn, status: "403 Forbidden", body: #"{"ok":false}"#)
            return
        }
        // GET /state — the snapshot the web polls (via Go) to drive the bar. Read
        // on main (the AV/MediaPlayer thread) so it never races the engine.
        if req.method == "GET", req.path == "/state" {
            let snap = DispatchQueue.main.sync { self.player.snapshot() }
            respond(conn, status: "200 OK", body: stateJSON(snap))
            return
        }
        // GET /levels — the live audio spectrum frame. Read off-main (AudioLevels is
        // internally locked); proxied to the browser by Go's /api/playback/levels.
        if req.method == "GET", req.path == "/levels" {
            respond(conn, status: "200 OK", body: player.levelsJSON())
            return
        }
        guard req.method == "POST" else {
            respond(conn, status: "404 Not Found", body: #"{"ok":false}"#)
            return
        }
        let obj = (try? JSONSerialization.jsonObject(with: req.body)) as? [String: Any] ?? [:]

        switch req.path {
        case "/play":
            guard let items = parseQueue(obj) else {
                respond(conn, status: "400 Bad Request", body: #"{"ok":false,"error":"missing queue"}"#)
                return
            }
            let start = obj["startIndex"] as? Int ?? 0
            let rpt = obj["repeat"] as? String ?? "off"
            // The broker already resolved the Source (ids → URLs); the engine just
            // plays what it was handed.
            DispatchQueue.main.async { [player] in player.setQueue(items, startIndex: start, repeatMode: rpt) }
        case "/setUpcoming":
            // The songs after the current one, already resolved; an empty list clears them.
            guard let items = parseQueue(obj, allowEmpty: true) else {
                respond(conn, status: "400 Bad Request", body: #"{"ok":false,"error":"missing queue"}"#)
                return
            }
            DispatchQueue.main.async { [player] in player.setUpcoming(items) }
        case "/pause":
            DispatchQueue.main.async { [player] in player.pausePlayback() }
        case "/resume":
            DispatchQueue.main.async { [player] in player.resumePlayback() }
        case "/next":
            DispatchQueue.main.async { [player] in player.next() }
        case "/prev":
            DispatchQueue.main.async { [player] in player.prev() }
        case "/seek":
            let pos = (obj["positionSeconds"] as? NSNumber)?.doubleValue ?? 0
            DispatchQueue.main.async { [player] in player.seek(toSeconds: pos) }
        case "/setRepeat":
            let mode = obj["mode"] as? String ?? "off"
            DispatchQueue.main.async { [player] in player.setRepeat(mode) }
        case "/setVolume":
            let level = (obj["level"] as? NSNumber)?.doubleValue ?? 1.0
            DispatchQueue.main.async { [player] in player.setVolume(level) }
        default:
            respond(conn, status: "404 Not Found", body: #"{"ok":false}"#)
            return
        }
        respond(conn, status: "200 OK", body: #"{"ok":true}"#)
    }

    // Build [QueueItem] from the broker payload; skips malformed entries.
    /// The body's queue, or nil when it has none. `allowEmpty` takes an empty list as
    /// one (/setUpcoming clears what's next with it); /play needs at least one song.
    private func parseQueue(_ obj: [String: Any], allowEmpty: Bool = false) -> [QueueItem]? {
        guard let raw = obj["queue"] as? [[String: Any]], allowEmpty || !raw.isEmpty else { return nil }
        let items: [QueueItem] = raw.compactMap { q in
            guard let id = q["trackId"] as? String,
                  let urlStr = q["url"] as? String,
                  let url = URL(string: urlStr),
                  PlaybackControlServer.isLocal(url) else { return nil }
            return QueueItem(
                trackId: id,
                url: url,
                title: q["title"] as? String ?? "",
                artist: q["artist"] as? String ?? "",
                album: q["album"] as? String ?? "",
                durationSeconds: (q["durationSeconds"] as? NSNumber)?.doubleValue ?? 0
            )
        }
        return items.isEmpty && !allowEmpty ? nil : items
    }

    private func stateJSON(_ s: PlaybackState) -> String {
        // Track ids are alphanumeric (Navidrome); JSON-encode the string safely anyway.
        let tid: String
        if let id = s.currentTrackId, let d = try? JSONSerialization.data(withJSONObject: [id]),
           let arr = String(data: d, encoding: .utf8) {
            tid = String(arr.dropFirst().dropLast()) // ["x"] → "x"
        } else {
            tid = "null"
        }
        func num(_ d: Double) -> String { d.isFinite ? String(format: "%.3f", d) : "0" }
        // Failures carry free text (the error), so they go through JSONSerialization.
        let failures = s.failures.map { ["seq": $0.seq, "trackId": $0.trackId, "error": $0.error] as [String: Any] }
        let failuresJSON = (try? JSONSerialization.data(withJSONObject: failures))
            .flatMap { String(data: $0, encoding: .utf8) } ?? "[]"
        return "{\"currentTrackId\":\(tid),\"positionSeconds\":\(num(s.positionSeconds)),"
            + "\"durationSeconds\":\(num(s.durationSeconds)),\"isPlaying\":\(s.isPlaying),"
            + "\"queueIndex\":\(s.queueIndex),\"queueLength\":\(s.queueLength),"
            + "\"failures\":\(failuresJSON)}"
    }

    private func respond(_ conn: NWConnection, status: String, body: String) {
        let head = "HTTP/1.1 \(status)\r\nContent-Type: application/json\r\n"
            + "Content-Length: \(body.utf8.count)\r\nConnection: close\r\n\r\n"
        conn.send(content: Data((head + body).utf8), completion: .contentProcessed { _ in
            conn.cancel()
        })
    }
}

let app = NSApplication.shared
let delegate = AppDelegate()
app.delegate = delegate
app.setActivationPolicy(.accessory)   // menu-bar only, no Dock icon
app.run()

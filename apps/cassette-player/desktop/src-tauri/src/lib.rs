//! Cassette Player — macOS desktop shell (Tauri).
//!
//! The shell bundles the Cassette web UI as a self-contained Next.js "standalone"
//! server and spawns it on a fixed loopback port at launch, then points the
//! window at 127.0.0.1. The entire UI + static assets run in-app (instant); only
//! data queries reach the cloud database (Neon). A small splash — the bundled
//! `frontendDist` index.html — shows until the local server accepts connections.
//!
//! Path resolution differs by build:
//!   - debug (`tauri dev`): system Node + the repo's `.next/standalone` build.
//!   - release (`tauri build`): Node + server tree bundled under the resource dir.

use std::fs::{File, OpenOptions};
use std::io::Write;
use std::net::TcpStream;
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use tauri::{Emitter, Manager, RunEvent};
use tauri_plugin_updater::UpdaterExt;

/// Desktop device-token pairing (keychain + loopback callback catcher). The
/// commands are invoked from the webview to pair the device and read the stored
/// token — the client half of dropping the bundled DB credential.
mod add_music;
mod pairing;
/// What the shell needs from Windows itself (the Windows port, 2026-11-07).
mod win;

/// Fixed loopback port for the bundled Next.js server.
const PORT: u16 = 41730;

/// Set true when the app is quitting (RunEvent::Exit) so the hub watchdog stands
/// down instead of respawning a child into the shutdown reap_hub is executing.
static SHUTTING_DOWN: AtomicBool = AtomicBool::new(false);

/// Rotate a log file at ~5MB so on-disk logs stay bounded but always keep the
/// prior run's tail. Matches the native agent + Go sidecar rotation policy.
const LOG_ROTATE_BYTES: u64 = 5 * 1024 * 1024;

/// On-disk log directory, shared with the native menu-bar agent so a single
/// "Reveal Diagnostics" in either surface opens one folder holding every log:
/// `~/Library/Logs/Cassette Player/` (WITH "Player" — the agent writes
/// `supervisor.log` here too).
fn log_dir() -> PathBuf {
    // Windows: the person's local app data. HOME is usually unset there, which put the logs in a relative
    // "Library/Logs" folder wherever the app happened to start.
    #[cfg(target_os = "windows")]
    {
        if let Some(local) = std::env::var_os("LOCALAPPDATA") {
            return PathBuf::from(local).join("Cassette").join("Logs");
        }
    }
    let home = std::env::var_os("HOME")
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("."));
    home.join("Library/Logs/Cassette Player")
}

/// Open a rotating, append-only log file in `log_dir()`. Best-effort: any error
/// (missing HOME, unwritable dir) is returned so callers can fall back — a log
/// that won't open must never block launch.
fn open_log(name: &str) -> std::io::Result<File> {
    let dir = log_dir();
    std::fs::create_dir_all(&dir)?;
    let path = dir.join(name);
    if let Ok(meta) = std::fs::metadata(&path) {
        if meta.len() > LOG_ROTATE_BYTES {
            // Keep exactly one prior generation.
            let _ = std::fs::rename(&path, dir.join(format!("{name}.1")));
        }
    }
    OpenOptions::new().create(true).append(true).open(&path)
}

/// Send a child's stdout and stderr to the rotating log `name` (open_log). Never
/// blocks the spawn: if the log won't open the child inherits the shell's stdio,
/// and if its handle can't be copied for a second stream only stderr goes to the
/// file, since that is where all three children write their errors (Go's log,
/// Node's uncaught errors, the audio helper's NSLog).
fn log_child_output(cmd: &mut Command, name: &str) {
    match open_log(name) {
        Ok(log) => match log.try_clone() {
            Ok(err_log) => {
                cmd.stdout(Stdio::from(log)).stderr(Stdio::from(err_log));
            }
            Err(e) => {
                eprintln!("[cassette] {name} clone failed ({e}); stdout inherits");
                cmd.stderr(Stdio::from(log));
            }
        },
        Err(e) => eprintln!("[cassette] {name} unavailable ({e}); inheriting stdio"),
    }
}

/// Seconds since the Unix epoch — a dependency-free timestamp for log lines
/// (no chrono in this crate).
fn unix_secs() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

/// Install a panic hook that appends the panic — message, location, and a
/// captured backtrace — to a rotating on-disk file, in addition to the default
/// stderr print. Without this a Rust panic in the shell leaves nothing durable
/// once the process is gone.
///
/// RESIDUAL GAP: this catches *Rust* panics only. A hard crash in WebKit (the
/// webview) or in the spawned Node UI server is a separate process/native fault,
/// not a Rust panic, so it never reaches this hook — those land in the UI-server
/// log (below) or a system crash report, not here.
fn install_panic_hook() {
    // Preserve the default hook's stderr output, then also persist.
    let default_hook = std::panic::take_hook();
    std::panic::set_hook(Box::new(move |info| {
        default_hook(info);
        let payload = info.payload();
        let msg = payload
            .downcast_ref::<&str>()
            .map(|s| s.to_string())
            .or_else(|| payload.downcast_ref::<String>().cloned())
            .unwrap_or_else(|| "Box<dyn Any>".to_string());
        let location = info
            .location()
            .map(|l| format!("{}:{}", l.file(), l.line()))
            .unwrap_or_else(|| "unknown".to_string());
        let backtrace = std::backtrace::Backtrace::force_capture();
        if let Ok(mut f) = open_log(SHELL_LOG) {
            let _ = writeln!(
                f,
                "[{}] PANIC at {location}: {msg}\n{backtrace}",
                unix_secs()
            );
        }
    }));
}

/// Log file for the Rust shell's own panics.
const SHELL_LOG: &str = "cassette-shell.log";
/// Log file for the spawned Node UI server's stdout/stderr.
const UI_SERVER_LOG: &str = "ui-server.log";
/// Log file for the Go sidecar + Navidrome supervisor's stdout/stderr. Same name
/// the native agent used, so the diagnostics folder stays familiar.
const SIDECAR_LOG: &str = "supervisor.log";
/// Log file for the native audio helper's stdout/stderr (its NSLog lines), so a
/// track that won't play leaves a trace (BUG-791).
const AUDIO_LOG: &str = "audio-helper.log";

/// Route to land on once the server is ready. `/dashboard/resume` restores the
/// last workbench page within a day, else the library (see dashboard-resume.ts).
const LANDING: &str = "/dashboard/resume";

/// Where "Cassette Dev.app" (identifier ….dev) opens: the desk, the new desktop
/// library that is being built against this window (stage 3, 2026-10-21). It is
/// signed in by the dev server's own session cookie, not a device token, so the
/// pairing check below doesn't apply. The shipped app keeps LANDING.
const DEV_LANDING: &str = "/desk";

/// The route the window opens on when CASSETTE_LANDING is not set. A shipped
/// (release) build with NO readable device token is UNPAIRED: it carries no
/// credential, so the dashboard would only bounce to sign-in. Open the pairing
/// screen instead; pairing relaunches the app (relaunch) so spawn_server picks up the new
/// token and the normal landing resolves. Dev builds always return LANDING, so
/// `tauri dev` is unchanged even before pairing.
fn default_landing() -> String {
    #[cfg(not(debug_assertions))]
    {
        // Treat a keyring/secret-store error (BUG-251) the same as "not
        // paired" for ROUTING purposes: open the pairing screen either way.
        // That screen has an error box for a pairing that fails; this call
        // site only picks a landing URL, so it has nowhere to surface a
        // message even if it tried.
        match pairing::get_device_token() {
            Ok(Some(_)) => {}
            Ok(None) | Err(_) => return "/desktop/connect".to_string(),
        }
    }
    LANDING.to_string()
}

/// Every child process the shell owns — the Node UI server, the Go sidecar (which
/// supervises Navidrome), and the native audio helper — tracked together so the
/// app reaps the WHOLE hub when it quits. This is the reconciliation fix: before,
/// quitting the window left the sidecar + Navidrome running as a separate
/// "Cassette Player". Each entry is labeled for the log.
#[derive(Clone)]
struct Hub(Arc<Mutex<Vec<(&'static str, Child)>>>);

impl Hub {
    fn push(&self, label: &'static str, child: Child) {
        self.0.lock().unwrap().push((label, child));
    }
}

/// Parse a `KEY=VALUE` env file (`#` comments, optional surrounding quotes) into
/// pairs — the Rust mirror of the native agent's loadEnvFile, so the sidecar sees
/// the exact configuration the standalone "Cassette Player" used to hand it.
fn load_env_file(path: &PathBuf) -> Vec<(String, String)> {
    let mut out = Vec::new();
    let Ok(text) = std::fs::read_to_string(path) else {
        return out;
    };
    for raw in text.lines() {
        let line = raw.trim();
        if line.is_empty() || line.starts_with('#') {
            continue;
        }
        let Some((k, v)) = line.split_once('=') else {
            continue;
        };
        let mut v = v.trim().to_string();
        if v.len() >= 2 && v.starts_with('"') && v.ends_with('"') {
            v = v[1..v.len() - 1].to_string();
        }
        out.push((k.trim().to_string(), v));
    }
    out
}

/// Resource-relative paths to the native hub pieces the SHIPPED app bundles. Only
/// resolved for the shipped bundled build — `tauri dev` keeps using a separately
/// run Cassette Player, so none of this runs in dev and we never have to guess a
/// dev sidecar configuration.
#[derive(Clone)]
struct HubPaths {
    sidecar: PathBuf,
    navidrome: PathBuf,
    bin_dir: PathBuf,
    certs_dir: PathBuf,
    env_file: PathBuf,
    ffmpeg: PathBuf,
    mpv: PathBuf,
    /// The trimmed native agent, nested as a helper app inside the bundle. macOS
    /// only - Windows has no audio helper (the OS now-playing integration is a
    /// macOS-only feature for now), so it carries None there.
    audio_helper: Option<PathBuf>,
}

fn resolve_hub_paths(app: &tauri::App) -> Option<HubPaths> {
    let res = app.path().resource_dir().ok()?;
    let bin_dir = res.join("bin");

    // The sidecar + Navidrome executables carry a `.exe` suffix on Windows and none
    // on macOS. The non-Windows path keeps the exact macOS names.
    #[cfg(not(target_os = "windows"))]
    let (sidecar, navidrome) = (res.join("cassette-sidecar"), res.join("navidrome"));
    #[cfg(target_os = "windows")]
    let (sidecar, navidrome) = (res.join("cassette-sidecar.exe"), res.join("navidrome.exe"));

    // The audio helper is a macOS-only Swift app (there is no Windows or Linux
    // equivalent); Linux drives mpv directly from the Go sidecar (see
    // playback_platform_linux.go), so both non-macOS platforms carry None.
    #[cfg(target_os = "macos")]
    let audio_helper = Some(res.join("CassetteAudio.app/Contents/MacOS/CassetteAudio"));
    #[cfg(not(target_os = "macos"))]
    let audio_helper: Option<PathBuf> = None;

    // The bundled ffmpeg/mpv carry a `.exe` suffix on Windows and none on macOS,
    // matching how CI stages them under bin/. Without this the Windows paths would
    // never resolve (.exists() would be false) and ND_FFMPEGPATH/ND_MPVPATH would
    // stay unset, forcing Navidrome to hunt for a PATH-resolved ffmpeg. The
    // non-Windows branch keeps the exact macOS names. The rip CLIs (cd-paranoia,
    // flac, fpcalc) are not set here; they resolve through the bin_dir PATH prefix
    // below, where Windows exec appends `.exe` to the bare names automatically.
    #[cfg(not(target_os = "windows"))]
    let (ffmpeg, mpv) = (bin_dir.join("ffmpeg"), bin_dir.join("mpv"));
    #[cfg(target_os = "windows")]
    let (ffmpeg, mpv) = (bin_dir.join("ffmpeg.exe"), bin_dir.join("mpv.exe"));

    Some(HubPaths {
        sidecar,
        navidrome,
        ffmpeg,
        mpv,
        bin_dir,
        certs_dir: res.join("certs"),
        env_file: res.join("cassette.env"),
        audio_helper,
    })
}

/// Expand %VAR% tokens (%USERPROFILE%, %APPDATA%, ...) in a bundled env value on
/// Windows. An unresolved or empty token is left intact rather than blanked, so a
/// stray percent never silently eats a path segment.
#[cfg(target_os = "windows")]
fn expand_windows_env_tokens(value: &str) -> String {
    let mut out = String::with_capacity(value.len());
    let mut rest = value;
    while let Some(start) = rest.find('%') {
        out.push_str(&rest[..start]);
        let after = &rest[start + 1..];
        let Some(end) = after.find('%') else {
            // Unterminated percent: emit the remainder verbatim and stop.
            out.push('%');
            out.push_str(after);
            return out;
        };
        let name = &after[..end];
        match std::env::var(name) {
            Ok(val) if !name.is_empty() => out.push_str(&val),
            // Not a resolvable var (or an empty %%): keep the literal token.
            _ => {
                out.push('%');
                out.push_str(name);
                out.push('%');
            }
        }
        rest = &after[end + 1..];
    }
    out.push_str(rest);
    out
}

/// Expand $VAR and ${VAR} tokens (e.g. $HOME) in a bundled env value on Linux
/// and macOS. Both bundled cassette.env files ship per-user paths as literal
/// `$HOME` tokens for the exact same reason Windows ships %VAR% tokens: the
/// machine that builds the app can't know the end user's home directory (the
/// Linux CI runner's, or on macOS the builder's own /Users/<name>, which baked
/// every installed copy onto the founder's folders), so the token is resolved
/// here, on the user's own machine, at spawn time, not at build time. Mirrors expand_windows_env_tokens's contract: an unresolved or
/// empty token is left intact rather than blanked, so a stray '$' never
/// silently eats a path segment. Handles both the bare $VAR form cassette.env
/// actually uses today (name = the run of ASCII letters/digits/underscore
/// after the '$', the same identifier rule a shell uses) and the braced
/// ${VAR} form, for any future cassette.env value that needs to butt up
/// against a following letter (e.g. "${HOME}s").
#[cfg(any(target_os = "linux", target_os = "macos"))]
fn expand_posix_env_tokens(value: &str) -> String {
    let mut out = String::with_capacity(value.len());
    let mut rest = value;
    while let Some(start) = rest.find('$') {
        out.push_str(&rest[..start]);
        let after = &rest[start + 1..];
        if let Some(braced) = after.strip_prefix('{') {
            let Some(end) = braced.find('}') else {
                // Unterminated ${: emit the remainder verbatim and stop.
                out.push('$');
                out.push_str(after);
                return out;
            };
            let name = &braced[..end];
            match std::env::var(name) {
                Ok(val) if !name.is_empty() => out.push_str(&val),
                // Not a resolvable var (or an empty ${}): keep the literal token.
                _ => {
                    out.push_str("${");
                    out.push_str(name);
                    out.push('}');
                }
            }
            rest = &braced[end + 1..];
        } else {
            let name_len = after
                .find(|c: char| !(c.is_ascii_alphanumeric() || c == '_'))
                .unwrap_or(after.len());
            let name = &after[..name_len];
            if name.is_empty() {
                // A lone '$' with no identifier characters after it (end of
                // string, or followed by e.g. '/'): not a token, keep it literal.
                out.push('$');
                rest = after;
                continue;
            }
            match std::env::var(name) {
                Ok(val) => out.push_str(&val),
                Err(_) => {
                    out.push('$');
                    out.push_str(name);
                }
            }
            rest = &after[name_len..];
        }
    }
    out.push_str(rest);
    out
}

/// Spawn the Go sidecar (which supervises Navidrome). Mirrors the env the native
/// agent's startSupervisor set. Returns the child so both the initial launch and
/// the watchdog restart share one recipe.
fn spawn_sidecar(paths: &HubPaths) -> std::io::Result<Child> {
    let mut cmd = Command::new(&paths.sidecar);
    for (k, v) in load_env_file(&paths.env_file) {
        // Windows cassette.env ships per-user paths as %VAR% tokens (the CI that
        // builds the installer can't know the end user's profile dir). Nothing
        // downstream expands them - CreateProcessW passes env verbatim and the Go
        // sidecar reads with os.Getenv - so resolve them here, or Navidrome scans
        // a literal "%APPDATA%\..." junk folder and the library looks empty.
        #[cfg(target_os = "windows")]
        let v = expand_windows_env_tokens(&v);
        // Same problem, same fix, on Linux and macOS: cassette.env ships $HOME
        // tokens (see linux-desktop.yml and bundle-macos.sh) because the
        // builder's $HOME is never the end user's. Nothing else expands them - the Go sidecar reads with
        // os.Getenv, and load_env_file above does a plain split_once('='),
        // no shell involved - so resolve them here or Navidrome/the sidecar
        // scan a literal "$HOME/..." directory that doesn't exist. BUG-246.
        #[cfg(any(target_os = "linux", target_os = "macos"))]
        let v = expand_posix_env_tokens(&v);
        cmd.env(k, v);
    }
    cmd.env("CASSETTE_SUPERVISE", "1")
        .env("CASSETTE_NAVIDROME_BIN", &paths.navidrome)
        .env("SIDECAR_BIND_ADDR", "127.0.0.1")
        .env("CASSETTE_LOCAL_KEY", pairing::local_key())
        .env("SIDECAR_BUNDLED_CERT_DIR", &paths.certs_dir);
    if paths.ffmpeg.exists() {
        cmd.env("ND_FFMPEGPATH", &paths.ffmpeg);
    }
    if paths.mpv.exists() {
        cmd.env("ND_MPVPATH", &paths.mpv);
    }
    // Bundled tools first on PATH (cd-paranoia / flac / fpcalc for ripping). The
    // separator and empty-PATH fallback are POSIX on macOS and differ on Windows;
    // the non-Windows branch is byte-identical to the original.
    #[cfg(not(target_os = "windows"))]
    let path_prefix = format!(
        "{}:{}",
        paths.bin_dir.display(),
        std::env::var("PATH").unwrap_or_else(|_| "/usr/bin:/bin".into())
    );
    #[cfg(target_os = "windows")]
    let path_prefix = format!(
        "{};{}",
        paths.bin_dir.display(),
        std::env::var("PATH").unwrap_or_default()
    );
    cmd.env("PATH", path_prefix);
    // Capture stdout/stderr to a rotating supervisor log (the sidecar must always
    // spawn, log or not).
    log_child_output(&mut cmd, SIDECAR_LOG);
    spawn_owned(&mut cmd)
}

/// Start a hub child. On Windows it opens no console window and ends with the app, a crash included (win.rs).
fn spawn_owned(cmd: &mut Command) -> std::io::Result<Child> {
    #[cfg(target_os = "windows")]
    win::no_console(cmd);
    let child = cmd.spawn()?;
    #[cfg(target_os = "windows")]
    win::end_with_app(&child);
    Ok(child)
}

/// Spawn the native audio helper (AVFoundation engine + control server + disc
/// watch). Nearly config-free: the broker hands it fully-resolved stream URLs and
/// it talks to the sidecar on hardcoded loopback ports. macOS only - Windows has
/// no audio helper (audio_helper is None), so this is compiled out on Windows and
/// Linux.
#[cfg(target_os = "macos")]
fn spawn_audio(paths: &HubPaths) -> std::io::Result<Child> {
    let helper = paths.audio_helper.as_ref().ok_or_else(|| {
        std::io::Error::new(std::io::ErrorKind::NotFound, "no audio helper on this platform")
    })?;
    let mut cmd = Command::new(helper);
    cmd.env("CASSETTE_LOCAL_KEY", pairing::local_key());
    // Its NSLog lines (each track it starts, a control server that won't come up)
    // went nowhere, so a playback failure left no trace (BUG-791). NSLog copies to
    // stderr when stderr is a file, so the log catches them.
    log_child_output(&mut cmd, AUDIO_LOG);
    cmd.spawn()
}

/// Spawn the Go sidecar and the native audio helper, pushing both into the Hub so
/// RunEvent::Exit reaps them. Best-effort per child: a failure is logged, never
/// fatal (the UI still runs; playback just won't work until it's fixed — the
/// watchdog keeps retrying a child that failed here).
fn spawn_hub(hub: &Hub, paths: &HubPaths) {
    match spawn_sidecar(paths) {
        Ok(child) => hub.push("sidecar", child),
        Err(e) => eprintln!("[cassette] failed to spawn sidecar: {e}"),
    }
    // The audio helper is macOS only; Windows and Linux have no now-playing
    // engine to spawn here (mpv is spawned differently - by the Go sidecar, not
    // by this Rust function).
    #[cfg(target_os = "macos")]
    match spawn_audio(paths) {
        Ok(child) => hub.push("audio", child),
        Err(e) => eprintln!("[cassette] failed to spawn audio helper: {e}"),
    }
}

/// SIGTERM every hub child, wait up to ~8s for a graceful exit, then SIGKILL any
/// straggler. CRITICAL: the sidecar must get SIGTERM, NOT `Child::kill()`'s
/// SIGKILL — it traps SIGTERM to stop Navidrome, so a SIGKILL would orphan
/// Navidrome (the exact split-brain this whole change fixes). Mirrors the native
/// agent's applicationWillTerminate.
fn reap_hub(hub: &Hub) {
    let mut children = hub.0.lock().unwrap();
    // Signal all first so they shut down in parallel.
    for (label, child) in children.iter() {
        // macOS: SIGTERM, never SIGKILL - the sidecar traps SIGTERM to stop
        // Navidrome, so a SIGKILL would orphan Navidrome. Unchanged from before.
        #[cfg(not(target_os = "windows"))]
        {
            eprintln!("[cassette] SIGTERM {label} (pid {})", child.id());
            let _ = Command::new("/bin/kill")
                .args(["-TERM", &child.id().to_string()])
                .status();
        }
        // Windows has no SIGTERM. The sidecar spawns Navidrome as its child, so a
        // process TREE kill (taskkill /T) takes both down together and avoids the
        // orphan the macOS SIGTERM path prevents. Less graceful than SIGTERM (no
        // clean Navidrome shutdown), but Navidrome uses SQLite and is crash-safe,
        // so it is acceptable for the first Windows build.
        #[cfg(target_os = "windows")]
        {
            eprintln!("[cassette] taskkill /T /F {label} (pid {})", child.id());
            let mut kill = Command::new("taskkill");
            kill.args(["/PID", &child.id().to_string(), "/T", "/F"]);
            win::no_console(&mut kill);
            let _ = kill.status();
        }
    }
    let deadline = Instant::now() + Duration::from_secs(8);
    for (label, child) in children.iter_mut() {
        loop {
            match child.try_wait() {
                Ok(Some(_)) => break,
                Ok(None) => {
                    if Instant::now() >= deadline {
                        eprintln!("[cassette] {label} didn't exit in time — SIGKILL");
                        let _ = child.kill();
                        let _ = child.wait();
                        break;
                    }
                    std::thread::sleep(Duration::from_millis(100));
                }
                Err(_) => break,
            }
        }
    }
}

/// One supervised hub child: a label + a spawner that reclaims its port(s) and
/// starts a fresh process. Boxed so the Node UI server, the Go sidecar, and the
/// native audio helper share one supervision loop.
struct Supervised {
    label: &'static str,
    spawn: Box<dyn Fn() -> std::io::Result<Child> + Send>,
}

/// Per-child restart backoff, owned by the watchdog thread.
struct Backoff {
    last_start: Instant,
    fast_deaths: u32,
    next_attempt: Instant,
}

/// How often the watchdog inspects the hub for a dead child.
const WATCHDOG_INTERVAL: Duration = Duration::from_secs(3);
/// A child that dies within this window of (re)starting is crash-looping — its
/// restart backoff escalates rather than hammering a broken binary.
const FAST_DEATH_WINDOW: Duration = Duration::from_secs(20);

/// Append a watchdog line to the shell log (and stderr). Best-effort.
fn log_watchdog(msg: &str) {
    if let Ok(mut f) = open_log(SHELL_LOG) {
        let _ = writeln!(f, "[{}] [watchdog] {msg}", unix_secs());
    }
    eprintln!("[cassette][watchdog] {msg}");
}

/// True once the process has exited (any status) or can't be queried — either way
/// it's not running and should be restarted. try_wait also reaps the zombie.
fn child_exited(child: &mut Child) -> bool {
    matches!(child.try_wait(), Ok(Some(_)) | Err(_))
}

/// Supervise the hub: if a managed child exits while the app is running, restart
/// it (with escalating backoff on a crash loop) and swap the fresh process into
/// the Hub so quit still reaps it. This is the durable fix for the silent
/// stranding where the Node UI server (or the sidecar / audio helper) was spawned
/// once at launch, and a single mid-session crash left the transport frozen with
/// no way to recover short of relaunching the app. Also recovers a child whose
/// initial spawn failed (no Hub entry yet). Stops the moment SHUTTING_DOWN is set.
fn start_hub_watchdog(hub: Hub, recipes: Vec<Supervised>) {
    if recipes.is_empty() {
        return;
    }
    std::thread::spawn(move || {
        let now = Instant::now();
        let mut backoff: Vec<Backoff> = recipes
            .iter()
            .map(|_| Backoff {
                last_start: now,
                fast_deaths: 0,
                next_attempt: now,
            })
            .collect();
        loop {
            std::thread::sleep(WATCHDOG_INTERVAL);
            if SHUTTING_DOWN.load(Ordering::SeqCst) {
                return;
            }
            let mut children = hub.0.lock().unwrap();
            for (i, r) in recipes.iter().enumerate() {
                // Dead = no entry for this label yet (initial spawn failed) or the
                // process has exited.
                let dead = match children.iter_mut().find(|(l, _)| *l == r.label) {
                    Some((_, c)) => child_exited(c),
                    None => true,
                };
                if !dead {
                    continue;
                }
                let now = Instant::now();
                if now < backoff[i].next_attempt {
                    continue; // still backing off from a recent restart
                }
                // Re-check under the lock so we can never respawn into a shutdown
                // that reap_hub is already executing.
                if SHUTTING_DOWN.load(Ordering::SeqCst) {
                    return;
                }
                // Escalate when it died fast (crash loop); reset when it had been up
                // a healthy while.
                if now.duration_since(backoff[i].last_start) < FAST_DEATH_WINDOW {
                    backoff[i].fast_deaths = (backoff[i].fast_deaths + 1).min(6);
                } else {
                    backoff[i].fast_deaths = 0;
                }
                match (r.spawn)() {
                    Ok(child) => {
                        if let Some(slot) = children.iter_mut().find(|(l, _)| *l == r.label) {
                            slot.1 = child;
                        } else {
                            children.push((r.label, child));
                        }
                        backoff[i].last_start = now;
                        log_watchdog(&format!(
                            "restarted {} (crash streak {})",
                            r.label, backoff[i].fast_deaths
                        ));
                    }
                    Err(e) => log_watchdog(&format!("failed to restart {}: {e}", r.label)),
                }
                // Rate-limit the next attempt: 3s, 6s, 12s… capped at ~60s.
                let secs = (3u64 << backoff[i].fast_deaths.min(5)).min(60);
                backoff[i].next_attempt = now + Duration::from_secs(secs);
            }
        }
    });
}

/// Locate a system Node runtime: what a dev build runs on, and the fallback when
/// a shipped build's own bundled Node (see resolve_paths) is somehow missing.
fn node_bin() -> PathBuf {
    ["/opt/homebrew/bin/node", "/usr/local/bin/node", "/usr/bin/node"]
        .iter()
        .map(PathBuf::from)
        .find(|p| p.exists())
        .unwrap_or_else(|| PathBuf::from("node"))
}

/// Resolve `(node_binary, server_root, env_file)`. `server_root` is the
/// standalone root that contains `apps/cassette/server.js` + `node_modules`.
#[allow(unused_variables)]
fn resolve_paths(app: &tauri::App) -> (PathBuf, PathBuf, PathBuf) {
    #[cfg(debug_assertions)]
    {
        // Dev: the repo's standalone build, resolved from this crate's manifest
        // dir so it works regardless of the process CWD.
        let repo = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("../../../..")
            .canonicalize()
            .expect("resolve repo root");
        let server_root = repo.join("apps/cassette/.next/standalone");
        let env_file = repo.join("apps/cassette/.env.local");
        (node_bin(), server_root, env_file)
    }
    #[cfg(not(debug_assertions))]
    {
        // Release: the standalone server tree + its .env are bundled under the
        // app resource dir (see tauri.conf.json `bundle.resources`).
        let res = app.path().resource_dir().expect("resource dir");
        // Every platform ships a bundled Node runtime beside the server tree,
        // because a clean computer has no guaranteed system Node and the UI
        // server (and the pairing screen) can't start without it. On macOS
        // bundle-macos.sh stages an official Node and signs it with the app.
        // Fall back to a system Node if the bundled runtime is somehow missing.
        #[cfg(target_os = "windows")]
        let node = {
            let bundled = res.join("node.exe");
            if bundled.exists() {
                bundled
            } else {
                node_bin()
            }
        };
        #[cfg(not(target_os = "windows"))]
        let node = {
            let bundled = res.join("node");
            if bundled.exists() {
                bundled
            } else {
                node_bin()
            }
        };
        (node, res.join("server"), res.join("server/.env"))
    }
}

fn spawn_server(node: &PathBuf, server_root: &PathBuf, env_file: &PathBuf) -> std::io::Result<Child> {
    let server_js = server_root.join("apps/cassette/server.js");
    let mut cmd = Command::new(node);
    // Node loads the bundled secrets (DATABASE_URL, AUTH_SECRET, …) itself.
    if env_file.exists() {
        cmd.arg(format!("--env-file={}", env_file.display()));
    }
    cmd.arg(&server_js)
        .current_dir(server_root)
        .env("PORT", PORT.to_string())
        .env("HOSTNAME", "127.0.0.1")
        .env("NODE_ENV", "production")
        // The UI is served from a fresh loopback origin, so next-auth must trust
        // the incoming host and canonicalise on the exact loopback URL — pinning
        // AUTH_URL keeps sign-in redirects + the session cookie on one origin
        // (email/password credentials login works fully offline; no OAuth
        // callback registration needed for the desktop origin).
        .env("AUTH_TRUST_HOST", "true")
        .env("AUTH_URL", format!("http://localhost:{PORT}"))
        // Enables the app's /sidecar/* proxy (see app/sidecar/[...path]/route.ts):
        // the UI reaches the local Cassette Player sidecar through our own origin,
        // sidestepping its CORS allowlist which doesn't include this loopback port.
        .env("SIDECAR_PROXY_TARGET", "http://localhost:5173");

    // Device-token mode (Move 4 — the finish of "stop bundling the DB password").
    // The shipped server's .env carries NO DATABASE_URL / AUTH_SECRET; instead the
    // per-device bearer set at pairing (in the OS keychain) is injected here, so the
    // bundled Next server runs as a token-authenticated cloud client and its data
    // streams from CASSETTE_CLOUD_BASE (in the bundled .env) over that token.
    // Absent token = not paired yet: the server still boots (createLazyDb connects
    // lazily, so no DATABASE_URL is fine) and the UI drives pairing; nothing here
    // panics on a missing token. Release only — a dev build keeps its full
    // .env.local (DATABASE_URL present → DB mode), so `next dev` is unchanged.
    #[cfg(not(debug_assertions))]
    if let Ok(Some(token)) = pairing::get_device_token() {
        cmd.env("CASSETTE_PLAYER_TOKEN", token);
    }

    // Capture the Node server's stdout/stderr to a durable, rotating log so a
    // UI-server crash leaves evidence next to the shell + agent logs. NOT gated on
    // the open succeeding: the UI server ALWAYS spawns.
    log_child_output(&mut cmd, UI_SERVER_LOG);
    spawn_owned(&mut cmd)
}

/// Kill any stale server still holding the fixed port — orphaned by a previous
/// crash or a dev hot-reload (SIGKILL bypasses the graceful exit handler) — so
/// our fresh spawn can bind. Single-instance by design; only one app runs.
/// Parse a /proc/net/tcp or /proc/net/tcp6 file's TEXT (not the path - kept
/// pure and host-independent so it's unit-testable on any platform, since
/// this is only ever exercised for real on Linux) for the socket inode(s) of
/// every LISTEN-state socket bound to `port`. Field layout, from the kernel's
/// tcp_seq_show:
///   sl  local_address rem_address   st tx_queue:rx_queue tr:tm->when
///   retrnsmt  uid  timeout inode ...
/// local_address is "IP:PORT" in hex; the IP half is little-endian and needs
/// byte-swapping to read as a real address, but the PORT half is always
/// printed big-endian regardless, so a direct hex parse gives the real port
/// number with no byte-order handling needed. st == "0A" is TCP_LISTEN,
/// matching the `-sTCP:LISTEN` filter the lsof fallback below also uses.
#[cfg(any(target_os = "linux", test))]
fn parse_listening_inodes(tcp_file_text: &str, port: u16) -> std::collections::HashSet<u64> {
    let mut inodes = std::collections::HashSet::new();
    for line in tcp_file_text.lines().skip(1) {
        let fields: Vec<&str> = line.split_whitespace().collect();
        if fields.len() < 10 {
            continue;
        }
        let Some((_, port_hex)) = fields[1].split_once(':') else {
            continue;
        };
        let Ok(local_port) = u16::from_str_radix(port_hex, 16) else {
            continue;
        };
        if local_port != port || fields[3] != "0A" {
            continue;
        }
        if let Ok(inode) = fields[9].parse::<u64>() {
            inodes.insert(inode);
        }
    }
    inodes
}

/// Map each of `inodes` to its owning pid by scanning `<proc_root>/*/fd/*` for
/// a "socket:[<inode>]" symlink target. `proc_root` is a parameter (real
/// builds always pass "/proc") purely so a test can point this at a fake
/// directory tree instead - /proc itself doesn't exist off Linux. Best-effort:
/// a pid whose /fd this process can't read (not ours, or it already exited) is
/// silently skipped, exactly as skipping it in the lsof output would be.
#[cfg(any(target_os = "linux", test))]
fn pids_owning_inodes(proc_root: &std::path::Path, inodes: &std::collections::HashSet<u64>) -> Vec<i32> {
    let mut pids = Vec::new();
    let Ok(proc_dir) = std::fs::read_dir(proc_root) else {
        return pids;
    };
    for entry in proc_dir.flatten() {
        let Ok(pid) = entry.file_name().to_string_lossy().parse::<i32>() else {
            continue;
        };
        let Ok(fd_dir) = std::fs::read_dir(entry.path().join("fd")) else {
            continue;
        };
        for fd in fd_dir.flatten() {
            let Ok(target) = std::fs::read_link(fd.path()) else {
                continue;
            };
            let target = target.to_string_lossy();
            let matched = target
                .strip_prefix("socket:[")
                .and_then(|s| s.strip_suffix(']'))
                .and_then(|s| s.parse::<u64>().ok())
                .is_some_and(|inode| inodes.contains(&inode));
            if matched {
                pids.push(pid);
                break;
            }
        }
    }
    pids
}

/// The pids with a LISTEN socket on `port`, entirely via /proc - no lsof, no
/// PATH lookup of any kind (BUG-249). Best-effort: an unreadable /proc/<pid>/fd
/// (someone else's process, or a race where it already exited) is skipped.
#[cfg(target_os = "linux")]
fn listening_pids_via_proc(port: u16) -> Vec<i32> {
    let mut inodes = std::collections::HashSet::new();
    for path in ["/proc/net/tcp", "/proc/net/tcp6"] {
        if let Ok(text) = std::fs::read_to_string(path) {
            inodes.extend(parse_listening_inodes(&text, port));
        }
    }
    if inodes.is_empty() {
        return Vec::new();
    }
    pids_owning_inodes(std::path::Path::new("/proc"), &inodes)
}

/// Every pid listening on `port`, from Windows' own connection table (BUG-237).
#[cfg(target_os = "windows")]
fn listening_pids(port: u16) -> Vec<i32> {
    win::listening_pids(port)
}

/// Every pid listening on `port`: /proc first on Linux, then lsof (always present
/// on macOS; a silent no-op where it isn't installed).
#[cfg(not(target_os = "windows"))]
fn listening_pids(port: u16) -> Vec<i32> {
    #[allow(unused_mut)]
    let mut pids: Vec<i32> = Vec::new();
    #[cfg(target_os = "linux")]
    pids.extend(listening_pids_via_proc(port));
    if let Ok(out) = Command::new("lsof")
        .args(["-ti", &format!("tcp:{port}"), "-sTCP:LISTEN"])
        .output()
    {
        for pid in String::from_utf8_lossy(&out.stdout).split_whitespace() {
            if let Ok(pid) = pid.parse::<i32>() {
                if !pids.contains(&pid) {
                    pids.push(pid);
                }
            }
        }
    }
    pids
}

/// The full path of the program running as `pid`, if it can be read. Asked of
/// the system, never taken from the process's name: the UI server renames
/// itself "next-server", which `ps` reports in place of its path, so a stale
/// Cassette server would have looked like someone else's program.
fn program_of(pid: i32) -> Option<String> {
    #[cfg(target_os = "linux")]
    {
        return std::fs::read_link(format!("/proc/{pid}/exe"))
            .ok()
            .map(|p| p.to_string_lossy().into_owned());
    }
    #[cfg(target_os = "macos")]
    {
        // PROC_PIDPATHINFO_MAXSIZE is 4 * MAXPATHLEN.
        let mut buf = vec![0u8; 4096];
        // SAFETY: proc_pidpath writes at most `buffersize` bytes into `buf`, which
        // is that long, and returns how many it wrote (0 or less on failure).
        let n = unsafe { proc_pidpath(pid, buf.as_mut_ptr().cast(), buf.len() as u32) };
        if n <= 0 {
            return None;
        }
        buf.truncate(n as usize);
        return Some(String::from_utf8_lossy(&buf).into_owned());
    }
    #[cfg(target_os = "windows")]
    {
        return win::program_of(pid);
    }
    #[allow(unreachable_code)]
    None
}

// proc_pidpath(3), from libproc in the system library every Mac program links.
#[cfg(target_os = "macos")]
extern "C" {
    fn proc_pidpath(pid: i32, buffer: *mut std::ffi::c_void, buffersize: u32) -> i32;
}

/// The folder this app runs from: the .app bundle on macOS, the program's own
/// folder elsewhere. Anything running from inside it is ours.
fn own_install_root() -> Option<PathBuf> {
    let exe = std::env::current_exe().ok()?;
    exe.ancestors()
        .find(|a| a.extension().is_some_and(|e| e == "app"))
        .or_else(|| exe.parent())
        .map(|p| p.to_path_buf())
}

/// Whether `exe` is one of Cassette's own programs: inside this app, or inside any
/// copy of Cassette (Cassette.app, Cassette Dev.app, an older copy in Downloads).
/// Someone's own Navidrome, or the node behind a Vite dev server, is not (BUG-779).
fn is_cassette_program(exe: &str, own_root: Option<&std::path::Path>) -> bool {
    if own_root.is_some_and(|root| std::path::Path::new(exe).starts_with(root)) {
        return true;
    }
    exe.contains(".app/Contents/")
        && exe
            .split('/')
            .any(|part| part.starts_with("Cassette") && part.ends_with(".app"))
}

/// Ports another program was found holding, with that program, so the window can
/// say what is in the way instead of spinning (BUG-779, BUG-782).
static PORT_CONFLICTS: Mutex<Vec<(u16, String)>> = Mutex::new(Vec::new());

fn note_port_conflict(port: u16, holder: &str) {
    if let Ok(mut c) = PORT_CONFLICTS.lock() {
        if c.iter().any(|(p, h)| *p == port && h == holder) {
            return;
        }
        c.push((port, holder.to_string()));
    }
    log_watchdog(&format!("port {port} is held by {holder}; leaving it alone"));
}

/// Free `port` for one of our children by stopping whatever of OURS still holds it
/// (an orphan from a crash or an earlier launch). A program that isn't Cassette's
/// is left running and noted instead: it used to be killed outright, which took
/// down people's own music servers and dev servers on every launch (BUG-779).
fn reclaim_port(port: u16) {
    let own_root = own_install_root();
    for pid in listening_pids(port) {
        if pid == std::process::id() as i32 {
            continue;
        }
        match program_of(pid) {
            Some(exe) if is_cassette_program(&exe, own_root.as_deref()) => stop_pid(pid),
            Some(exe) => note_port_conflict(port, &exe),
            None => note_port_conflict(port, &format!("another program (pid {pid})")),
        }
    }
}

/// kill(2), declared directly rather than adding a libc/nix Cargo.toml
/// dependency for one syscall - Rust binaries already link libc on Linux by
/// default, so stopping a pid needs no external binary (BUG-249).
#[cfg(target_os = "linux")]
extern "C" {
    fn kill(pid: i32, sig: i32) -> i32;
}
#[cfg(target_os = "linux")]
const SIGKILL: i32 = 9;

fn stop_pid(pid: i32) {
    #[cfg(target_os = "linux")]
    {
        // SAFETY: kill(2) with a plain integer pid/signal has no memory-safety
        // preconditions; a pid that already exited just returns -1 (ESRCH).
        unsafe {
            kill(pid, SIGKILL);
        }
    }
    #[cfg(target_os = "windows")]
    win::stop_pid(pid);
    #[cfg(not(any(target_os = "linux", target_os = "windows")))]
    {
        let _ = Command::new("kill").args(["-9", &pid.to_string()]).status();
    }
}

#[cfg(test)]
mod reclaim_port_tests {
    use super::*;

    // A trimmed real /proc/net/tcp sample (header + 3 rows): a LISTEN socket
    // on port 0x9036 (36918), an ESTABLISHED connection on the SAME port
    // (must be excluded - it's not "holding" the port in the listening
    // sense), and a LISTEN socket on a different port.
    const SAMPLE_TCP: &str = "\
  sl  local_address rem_address   st tx_queue rx_queue tr tm->when retrnsmt   uid  timeout inode
   0: 00000000:9036 00000000:0000 0A 00000000:00000000 00:00000000 00000000     0        0 12345 1 0000000000000000 100 0 0 10 0
   1: 0100007F:9036 0100007F:C35A 01 00000000:00000000 00:00000000 00000000     0        0 99999 1 0000000000000000 100 0 0 10 0
   2: 00000000:1F90 00000000:0000 0A 00000000:00000000 00:00000000 00000000     0        0 55555 1 0000000000000000 100 0 0 10 0
";

    #[cfg(any(target_os = "macos", target_os = "linux"))]
    #[test]
    fn reads_a_process_path_from_the_system() {
        let me = std::env::current_exe().unwrap();
        let got = program_of(std::process::id() as i32).expect("own path");
        assert_eq!(
            std::fs::canonicalize(got).unwrap(),
            std::fs::canonicalize(me).unwrap()
        );
    }

    #[test]
    fn only_cassettes_own_programs_count_as_ours() {
        let root = std::path::Path::new("/Applications/Cassette.app");
        for exe in [
            "/Applications/Cassette.app/Contents/Resources/node/bin/node",
            "/Applications/Cassette.app/Contents/MacOS/cassette-sidecar",
            "/Applications/Cassette Dev.app/Contents/MacOS/navidrome",
            "/Users/x/Downloads/Cassette 2.app/Contents/MacOS/CassetteAudio",
        ] {
            assert!(is_cassette_program(exe, Some(root)), "{exe} is ours");
        }
        for exe in [
            "/opt/homebrew/bin/navidrome",
            "/Users/x/.nvm/versions/node/v22.1.0/bin/node",
            "/Applications/NotCassette.app/Contents/MacOS/thing",
            "/Users/x/Cassette/navidrome",
            "/Applications/Cassette.app.bak/navidrome",
        ] {
            assert!(!is_cassette_program(exe, Some(root)), "{exe} is someone else's");
        }
        // A renamed copy of this very app still counts, by its own folder.
        let renamed = std::path::Path::new("/Applications/Music Box.app");
        assert!(is_cassette_program("/Applications/Music Box.app/Contents/MacOS/navidrome", Some(renamed)));
    }

    #[test]
    fn finds_only_the_listen_socket_on_the_target_port() {
        let inodes = parse_listening_inodes(SAMPLE_TCP, 0x9036);
        assert_eq!(inodes, std::collections::HashSet::from([12345]));
    }

    #[test]
    fn ignores_a_non_listening_socket_on_the_same_port() {
        // Port 0x9036 also appears in an ESTABLISHED (st=01) row (inode
        // 99999) - must not be picked up.
        let inodes = parse_listening_inodes(SAMPLE_TCP, 0x9036);
        assert!(!inodes.contains(&99999));
    }

    #[test]
    fn finds_nothing_for_an_unused_port() {
        let inodes = parse_listening_inodes(SAMPLE_TCP, 0xBEEF);
        assert!(inodes.is_empty());
    }

    #[test]
    fn ignores_malformed_lines_without_panicking() {
        let text = "header line\nnot enough fields\n";
        let inodes = parse_listening_inodes(text, 80);
        assert!(inodes.is_empty());
    }

    #[test]
    fn maps_inode_to_owning_pid_via_fake_proc_tree() {
        // Real symlinks under a temp dir shaped like /proc/<pid>/fd/<n>,
        // pointing at socket:[<inode>] targets - exercises the exact
        // read_dir + read_link logic pids_owning_inodes uses, just rooted
        // somewhere other than /proc (which doesn't exist on this host).
        let tmp = std::env::temp_dir().join(format!(
            "cassette-proc-test-{}",
            std::process::id()
        ));
        let _ = std::fs::remove_dir_all(&tmp);
        let pid_fd_dir = tmp.join("4242").join("fd");
        std::fs::create_dir_all(&pid_fd_dir).unwrap();
        std::os::unix::fs::symlink("socket:[12345]", pid_fd_dir.join("3")).unwrap();
        std::os::unix::fs::symlink("/dev/null", pid_fd_dir.join("0")).unwrap();
        // A second pid dir with no matching inode, to confirm it's excluded.
        let other_fd_dir = tmp.join("9999").join("fd");
        std::fs::create_dir_all(&other_fd_dir).unwrap();
        std::os::unix::fs::symlink("socket:[777]", other_fd_dir.join("3")).unwrap();

        let inodes = std::collections::HashSet::from([12345u64]);
        let mut pids = pids_owning_inodes(&tmp, &inodes);
        pids.sort();
        assert_eq!(pids, vec![4242]);

        std::fs::remove_dir_all(&tmp).unwrap();
    }
}

#[cfg(test)]
mod shell_tests {
    use super::*;

    // BUG-870: a pulled release may still move an install back, but never below the floor.
    #[test]
    fn the_updater_never_goes_below_the_floor() {
        assert!(update_allowed((0, 5, 32)));
        assert!(update_allowed((0, 5, 40)));
        assert!(update_allowed((1, 0, 0)));
        assert!(!update_allowed((0, 5, 31)));
        assert!(!update_allowed((0, 4, 99)));
    }

    // BUG-791: a child's stdout AND stderr both land in its log under ~/Library/Logs,
    // which is where the audio helper's NSLog lines (stderr) now go.
    #[cfg(any(target_os = "macos", target_os = "linux"))]
    #[test]
    fn a_childs_output_lands_in_its_log() {
        let home = std::env::temp_dir().join(format!("cassette-log-test-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&home);
        let old_home = std::env::var_os("HOME");
        std::env::set_var("HOME", &home);
        let mut cmd = Command::new("/bin/sh");
        cmd.args(["-c", "echo to-stdout; echo to-stderr >&2"]);
        log_child_output(&mut cmd, "test-child.log");
        let status = cmd.status().unwrap();
        let text = std::fs::read_to_string(log_dir().join("test-child.log")).unwrap();
        match old_home {
            Some(h) => std::env::set_var("HOME", h),
            None => std::env::remove_var("HOME"),
        }
        std::fs::remove_dir_all(&home).unwrap();
        assert!(status.success());
        assert!(text.contains("to-stdout") && text.contains("to-stderr"), "{text}");
    }

    // The founder's 2026-10-28 call: closing the window keeps the music playing, so
    // the transport works without it, while anything answered on the page shows it.
    #[test]
    fn only_the_transport_eject_and_help_work_with_the_window_closed() {
        for id in ["play-pause", "next", "previous", "eject", "help"] {
            assert!(menu_item_works_hidden(id), "{id}");
        }
        for id in ["settings", "update", "add-music", "rip", "search", "now-playing"] {
            assert!(!menu_item_works_hidden(id), "{id}");
        }
    }
}

/// Poll `host:port` until it accepts a TCP connection (server is up).
fn wait_ready_addr(host: &str, port: u16, timeout: Duration) -> bool {
    let start = Instant::now();
    while start.elapsed() < timeout {
        if TcpStream::connect((host, port)).is_ok() {
            return true;
        }
        std::thread::sleep(Duration::from_millis(120));
    }
    false
}

/// Set while a window closed in full screen waits for the Mac to leave full screen
/// before it hides; bringing the window back first calls the hide off.
static HIDE_AFTER_FULLSCREEN: AtomicBool = AtomicBool::new(false);

/// About how long the Mac's animation out of full screen takes.
const FULLSCREEN_EXIT: Duration = Duration::from_millis(900);

/// Closing the window (red button, Cmd-W) hides it and the music keeps playing,
/// the way Music.app does (the founder, 2026-10-28 audit Q4). A window in full
/// screen leaves full screen first, since a full-screen window hidden in place
/// leaves an empty black Space behind.
fn hide_main_window(app: &tauri::AppHandle) {
    let Some(w) = app.get_webview_window("main") else {
        return;
    };
    if !w.is_fullscreen().unwrap_or(false) {
        let _ = w.hide();
        return;
    }
    HIDE_AFTER_FULLSCREEN.store(true, Ordering::SeqCst);
    let _ = w.set_fullscreen(false);
    std::thread::spawn(move || {
        std::thread::sleep(FULLSCREEN_EXIT);
        if HIDE_AFTER_FULLSCREEN.swap(false, Ordering::SeqCst) {
            let _ = w.hide();
        }
    });
}

/// Bring the window back after a close: the Dock icon, opening Cassette again,
/// Window > Cassette, a menu item whose answer is on the page, or a shell alert.
fn show_main_window(app: &tauri::AppHandle) {
    HIDE_AFTER_FULLSCREEN.store(false, Ordering::SeqCst);
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.show();
        let _ = w.unminimize();
        let _ = w.set_focus();
    }
}

/// Menu items that do their thing with the window closed, as Music.app's do: the
/// transport, Eject, and Help (it opens the browser). Every other item of ours is
/// answered on the page, so it brings the window back first.
fn menu_item_works_hidden(id: &str) -> bool {
    matches!(id, "play-pause" | "next" | "previous" | "eject" | "help")
}

/// A Mac alert from the shell itself, as a sheet on the window. Without a parent
/// window the dialog library's free-standing alert never appeared on screen
/// (seen testing the BUG-779 alert on the founder's Mac); the page's own alerts
/// always worked because they attach to the window. A sheet on a closed (hidden)
/// window never shows either, so the window comes back first.
fn shell_dialog(
    app: &tauri::AppHandle,
    message: impl Into<String>,
) -> tauri_plugin_dialog::MessageDialogBuilder<tauri::Wry> {
    use tauri_plugin_dialog::DialogExt;
    let builder = app.dialog().message(message);
    match app.get_webview_window("main") {
        Some(window) => {
            if !window.is_visible().unwrap_or(true) {
                show_main_window(app);
            }
            builder.parent(&window)
        }
        None => builder,
    }
}

/// Write `msg` on the splash in place of "Starting Cassette…" (BUG-782).
fn show_on_splash(app: &tauri::AppHandle, msg: &str) {
    if let Some(win) = app.get_webview_window("main") {
        let quoted = serde_json::to_string(msg).unwrap_or_default();
        let _ = win.eval(&format!(
            "(function(m){{var h=document.querySelector('.hint');\
             if(h){{h.textContent=m;h.classList.add('fail');}}\
             var t=document.querySelector('.tick');\
             if(t){{t.classList.add('slow');}}}})({quoted})"
        ));
    }
}

/// Whether everything listening on `port` is one of Cassette's own programs.
fn port_is_ours(port: u16) -> bool {
    let root = own_install_root();
    let pids = listening_pids(port);
    !pids.is_empty()
        && pids.iter().all(|&pid| {
            program_of(pid).is_some_and(|exe| is_cassette_program(&exe, root.as_deref()))
        })
}

/// How long the splash waits before it says something is wrong (BUG-782).
const SPLASH_PATIENCE: Duration = Duration::from_secs(60);

/// What each of our ports is for, in the person's terms.
fn port_purpose(port: u16) -> &'static str {
    match port {
        PORT => "Cassette's window",
        4533 => "Cassette's connection to your phones",
        4534 => "Cassette's music server",
        5173 => "Cassette's library",
        5174 => "Cassette's audio player",
        _ => "Cassette",
    }
}

/// A plain sentence naming the other program in the way on any of `ports`, if one
/// was found there (reclaim_port), or None.
fn conflict_message(ports: &[u16]) -> Option<String> {
    let conflicts = PORT_CONFLICTS.lock().ok()?;
    let (port, holder) = conflicts.iter().find(|(p, _)| ports.contains(p))?;
    let purpose = port_purpose(*port);
    // Just the program's name; its full path and the port are in the log.
    Some(match std::path::Path::new(holder).file_name() {
        Some(name) if std::path::Path::new(holder).is_absolute() => {
            let name = name.to_string_lossy();
            format!(
                "Another program, {name}, is using the connection {purpose} needs. \
                 Quit {name}, then reopen Cassette."
            )
        }
        _ => format!(
            "Another program is using the connection {purpose} needs. \
             Quit it, then reopen Cassette."
        ),
    })
}

/// Once the window is up: if another program holds one of the hub's ports, the
/// window works but music won't play, so say which program, once, in the Mac's
/// own alert (BUG-779).
fn warn_hub_port_conflicts(app: &tauri::AppHandle) {
    use tauri_plugin_dialog::MessageDialogKind;
    if let Some(msg) = conflict_message(&[5173, 4533, 4534, 5174]) {
        shell_dialog(app, msg)
            .title("Your music can't play yet")
            .kind(MessageDialogKind::Warning)
            .show(|_| {});
    }
}

/// Minimal `scheme://host[:port]/…` → `(host, port)` parse (no url crate).
fn host_port(url: &str) -> Option<(String, u16)> {
    let is_https = url.starts_with("https");
    let authority = url.split("://").nth(1)?.split('/').next()?;
    match authority.rsplit_once(':') {
        Some((h, p)) => Some((h.to_string(), p.parse().ok()?)),
        None => Some((authority.to_string(), if is_https { 443 } else { 80 })),
    }
}

/// Append an updater line to the shell log (and stderr). Best-effort: the
/// updater must never take down the app, so every step here is non-fatal.
fn log_update(msg: &str) {
    if let Ok(mut f) = open_log(SHELL_LOG) {
        let _ = writeln!(f, "[{}] [updater] {msg}", unix_secs());
    }
    eprintln!("[cassette][updater] {msg}");
}

/// Update surface, driven by the webview (not a silent background install). The
/// shipped app checks the signed release feed (`tauri.conf.json`
/// `plugins.updater.endpoints` + `pubkey`; the plugin verifies the minisign
/// signature against the embedded key before replacing anything, so a hijacked
/// feed can't push code) and shows an "UPDATE AVAILABLE" pill by the avatar — the
/// person chooses when to install. Both commands are best-effort and never panic.

/// Returns the version on offer (e.g. "0.2.0"), None when this is the one the
/// feed serves, or an error when the feed couldn't be asked, so "couldn't
/// check" is never shown as "up to date" (BUG-790). The pill polls this to decide
/// whether to show itself. A dev build (no configured updater) resolves to None.
#[tauri::command]
async fn check_for_update(app: tauri::AppHandle) -> Result<Option<String>, String> {
    let Ok(updater) = app.updater() else {
        return Ok(None);
    };
    match updater.check().await {
        Ok(Some(update)) => {
            log_update(&format!("update {} available", update.version));
            Ok(Some(update.version))
        }
        Ok(None) => Ok(None),
        Err(e) => {
            log_update(&format!("update check failed: {e}"));
            Err(e.to_string())
        }
    }
}

/// Set once the window has left the splash for the app. Until then the page
/// can't answer the menu, so the shell runs updates itself (BUG-790).
static UI_READY: AtomicBool = AtomicBool::new(false);

/// The shell's own update check, for when the page isn't there to do it: the
/// window never loaded (a release whose UI won't start would otherwise strand
/// everyone on it), or Check for Updates was chosen before it did. Asks before
/// installing. `say_when_nothing` is for a check the person asked for, which
/// always gets an answer.
fn shell_update_check(app: tauri::AppHandle, say_when_nothing: bool) {
    use tauri_plugin_dialog::{MessageDialogButtons, MessageDialogKind};
    tauri::async_runtime::spawn(async move {
        let Ok(updater) = app.updater() else {
            return;
        };
        match updater.check().await {
            Ok(Some(update)) => {
                let version = update.version.clone();
                log_update(&format!("update {version} available (shell check)"));
                let app2 = app.clone();
                shell_dialog(&app, format!(
                        "Cassette {version} is ready. Installing it restarts the app."
                    ))
                    .title("Update Cassette")
                    .buttons(MessageDialogButtons::OkCancelCustom(
                        "Install and Restart".into(),
                        "Not Now".into(),
                    ))
                    .show(move |yes| {
                        if !yes {
                            return;
                        }
                        tauri::async_runtime::spawn(async move {
                            log_update(&format!("installing update {version} (shell check)"));
                            if let Err(e) = update.download_and_install(|_, _| {}, || {}).await {
                                log_update(&format!("download/install of {version} FAILED: {e:?}"));
                                shell_dialog(&app2, format!(
                                        "Cassette {version} couldn't be installed ({e}). \
                                         Try again from Cassette > Check for Updates."
                                    ))
                                    .title("Update didn't install")
                                    .kind(MessageDialogKind::Warning)
                                    .show(|_| {});
                                return;
                            }
                            log_update(&format!("update {version} installed — relaunching"));
                            relaunch(&app2);
                        });
                    });
            }
            Ok(None) if say_when_nothing => {
                shell_dialog(&app, "Cassette is up to date.")
                    .title("Check for Updates")
                    .show(|_| {});
            }
            Ok(None) => {}
            Err(e) => {
                log_update(&format!("update check failed (shell check): {e}"));
                if say_when_nothing {
                    shell_dialog(&app, "Cassette couldn't check for updates. Check the internet connection and try again.")
                        .title("Check for Updates")
                        .kind(MessageDialogKind::Warning)
                        .show(|_| {});
                }
            }
        }
    });
}

/// Warn when the app runs from somewhere it can't update itself: straight off
/// the disk image, or from Downloads, where macOS runs it from a hidden
/// read-only copy (BUG-790). Release builds only.
fn warn_if_outside_applications(app: &tauri::AppHandle) {
    use tauri_plugin_dialog::{MessageDialogButtons, MessageDialogKind};
    // Only macOS runs an app from a disk image or a hidden read-only copy; elsewhere this warned on every launch.
    if cfg!(debug_assertions) || app.config().identifier.ends_with(".dev") || !cfg!(target_os = "macos") {
        return;
    }
    let Some(bundle) = own_install_root() else {
        return;
    };
    let home_apps = std::env::var_os("HOME").map(|h| PathBuf::from(h).join("Applications"));
    let in_applications = bundle.starts_with("/Applications")
        || home_apps.is_some_and(|h| bundle.starts_with(h));
    if in_applications {
        return;
    }
    log_update(&format!("running from {}, outside Applications", bundle.display()));
    let app2 = app.clone();
    shell_dialog(
        app,
        "Cassette can only update itself from your Applications folder. \
         Quit, drag Cassette into Applications, and open it from there.",
    )
    .title("Move Cassette to Applications")
    .kind(MessageDialogKind::Warning)
    .buttons(MessageDialogButtons::OkCancelCustom("Quit".into(), "Not Now".into()))
    .show(move |quit| {
        if quit {
            app2.exit(0);
        }
    });
}

/// Quit the whole hub and start the app again: after pairing, so spawn_server hands
/// the new token to a fresh UI server and the window opens on the normal landing.
/// app.restart() skips RunEvent::Exit, so reap here or the old sidecar, Navidrome
/// and audio helper keep holding their ports.
pub(crate) fn relaunch(app: &tauri::AppHandle) -> ! {
    SHUTTING_DOWN.store(true, Ordering::SeqCst);
    if let Some(hub) = app.try_state::<Hub>() {
        reap_hub(&hub);
    }
    app.restart()
}

/// The oldest release the updater will move this install to, a pulled release's
/// way back included (BUG-870). The signature covers the archive, not its number,
/// so whoever could write the feed's manifest could otherwise hand every install
/// an old signed build with holes since closed. Raise it with any release that
/// closes one: 0.5.32 is the first with the hub's first-run page and pairing
/// guarded (BUG-857, BUG-858).
const UPDATE_FLOOR: (u64, u64, u64) = (0, 5, 32);

fn update_allowed(version: (u64, u64, u64)) -> bool {
    version >= UPDATE_FLOOR
}

/// Download + install the newer build, then relaunch into it. Invoked when the
/// person clicks the pill. The plugin verifies the signature before it swaps the
/// bundle. On success this restarts and never returns; on failure it returns the
/// error string so the pill can surface it.
#[tauri::command]
async fn install_update(app: tauri::AppHandle) -> Result<(), String> {
    let updater = app.updater().map_err(|e| e.to_string())?;
    let update = updater
        .check()
        .await
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "no update available".to_string())?;
    let version = update.version.clone();
    log_update(&format!("installing update {version}"));
    if let Err(e) = update.download_and_install(|_chunk, _total| {}, || {}).await {
        // Log the FULL error so a failed swap/verify is diagnosable from the shell
        // log instead of vanishing into the pill's catch.
        log_update(&format!("download/install of {version} FAILED: {e:?}"));
        return Err(e.to_string());
    }
    log_update(&format!("update {version} installed — relaunching"));
    app.restart();
}

/// The window's own background on the Mac's appearance: the paper the page draws on, the light card stock
/// or the dark one (tauri.conf.json's backgroundColor is the dark one, for the moment before this runs).
fn window_paper(theme: tauri::Theme) -> tauri::window::Color {
    match theme {
        tauri::Theme::Light => tauri::window::Color(0xf3, 0xea, 0xdb, 0xff),
        _ => tauri::window::Color(0x1c, 0x19, 0x13, 0xff),
    }
}

/// The Mac's menu bar, the way a Mac music app has one (the founder, 2026-10-28 audit D-M5; File >
/// Rip from 2026-10-31). Each of our own items sends its id to the page as a "cassette:menu" event,
/// and the page does the thing (apps/cassette/src/app/desk/DeskShell.tsx, useMenuBar). Space and the
/// Cmd-arrows stay the page's own (no shortcut here): a menu shortcut fires even while typing in a
/// field, where those keys move the cursor (BUG-603, BUG-604).
#[cfg(not(target_os = "windows"))]
fn menu_bar(app: &tauri::AppHandle) -> tauri::Result<tauri::menu::Menu<tauri::Wry>> {
    use tauri::menu::{MenuBuilder, SubmenuBuilder};
    let item = |id: &str, label: &str, accel: Option<&str>| menu_item(app, id, label, accel);
    let cassette = SubmenuBuilder::new(app, "Cassette")
        .about(Some(about_cassette("Cassette")))
        .item(&item("licenses", "Open-Source Licenses", None)?)
        .separator()
        .item(&item("settings", "Settings…", Some("CmdOrCtrl+,"))?)
        .item(&item("update", "Check for Updates…", None)?)
        .separator()
        .services()
        .separator()
        .hide()
        .hide_others()
        .show_all()
        .separator()
        .quit()
        .build()?;
    let file = SubmenuBuilder::new(app, "File")
        .item(&item("add-music", "Add to Library…", Some("CmdOrCtrl+O"))?)
        .separator()
        .item(&item("rip", "Rip Disc", Some("CmdOrCtrl+R"))?)
        .item(&item("eject", "Eject Disc", Some("CmdOrCtrl+E"))?)
        .separator()
        .close_window()
        .build()?;
    let view = SubmenuBuilder::new(app, "View")
        .item(&item("search", "Search", Some("CmdOrCtrl+F"))?)
        .item(&item("now-playing", "Go to Current Song", Some("CmdOrCtrl+L"))?)
        .separator()
        .fullscreen()
        .build()?;
    // Closing the window keeps the music playing; Window > Cassette (like the Dock
    // icon) brings it back, as Window > Music does in Music.app.
    let window = SubmenuBuilder::new(app, "Window")
        .minimize()
        .maximize()
        .separator()
        .item(&item("show-window", "Cassette", Some("CmdOrCtrl+0"))?)
        .build()?;
    let help = SubmenuBuilder::new(app, "Help")
        .item(&item("help", "Cassette Help", None)?)
        .item(&item("show-logs", "Show Logs", None)?)
        .build()?;
    MenuBuilder::new(app)
        .items(&[&cassette, &file, &edit_menu(app)?, &view, &controls_menu(app)?, &window, &help])
        .build()
}

/// Windows' menu bar, inside the window. Windows has no app menu, no Services, no Hide Others and no Show All
/// (the menu library draws those as items that do nothing there), no full-screen item, and no Window menu to
/// bring a closed window back: the icon by the clock does that (tray_icon). Settings and Check for Updates move
/// into File, About and the Licenses into Help, and Quit is our own item so it always ends in RunEvent::Exit,
/// which reaps the hub.
#[cfg(target_os = "windows")]
fn menu_bar(app: &tauri::AppHandle) -> tauri::Result<tauri::menu::Menu<tauri::Wry>> {
    use tauri::menu::{MenuBuilder, SubmenuBuilder};
    let item = |id: &str, label: &str, accel: Option<&str>| menu_item(app, id, label, accel);
    let file = SubmenuBuilder::new(app, "File")
        .item(&item("add-music", "Add to Library…", Some("CmdOrCtrl+O"))?)
        .separator()
        .item(&item("rip", "Rip Disc", Some("CmdOrCtrl+R"))?)
        .item(&item("eject", "Eject Disc", Some("CmdOrCtrl+E"))?)
        .separator()
        .item(&item("settings", "Settings…", Some("CmdOrCtrl+,"))?)
        .item(&item("update", "Check for Updates…", None)?)
        .separator()
        .item(&item("quit", "Quit Cassette", Some("CmdOrCtrl+Q"))?)
        .build()?;
    let view = SubmenuBuilder::new(app, "View")
        .item(&item("search", "Search", Some("CmdOrCtrl+F"))?)
        .item(&item("now-playing", "Go to Current Song", Some("CmdOrCtrl+L"))?)
        .build()?;
    let help = SubmenuBuilder::new(app, "Help")
        .item(&item("help", "Cassette Help", None)?)
        .item(&item("show-logs", "Show Logs", None)?)
        .separator()
        .item(&item("licenses", "Open-Source Licenses", None)?)
        .about(Some(about_cassette("Help")))
        .build()?;
    MenuBuilder::new(app)
        .items(&[&file, &edit_menu(app)?, &view, &controls_menu(app)?, &help])
        .build()
}

fn menu_item(
    app: &tauri::AppHandle,
    id: &str,
    label: &str,
    accel: Option<&str>,
) -> tauri::Result<tauri::menu::MenuItem<tauri::Wry>> {
    let b = tauri::menu::MenuItemBuilder::with_id(id, label);
    match accel {
        Some(a) => b.accelerator(a).build(app),
        None => b.build(app),
    }
}

/// The open-source acknowledgement every GPL and LGPL part asks for (BUG-780): a line in About, and the Licenses
/// folder one click away, in the menu named here (Cassette on macOS, Help on Windows).
fn about_cassette(licenses_menu: &str) -> tauri::menu::AboutMetadata<'static> {
    tauri::menu::AboutMetadataBuilder::new()
        .credits(Some(format!(
            "Cassette includes open-source software, among it Navidrome, FFmpeg, FLAC, \
             Chromaprint and libcdio. Their licences and source: {licenses_menu} > Open-Source Licenses."
        )))
        .build()
}

fn edit_menu(app: &tauri::AppHandle) -> tauri::Result<tauri::menu::Submenu<tauri::Wry>> {
    tauri::menu::SubmenuBuilder::new(app, "Edit")
        .undo()
        .redo()
        .separator()
        .cut()
        .copy()
        .paste()
        .select_all()
        .build()
}

fn controls_menu(app: &tauri::AppHandle) -> tauri::Result<tauri::menu::Submenu<tauri::Wry>> {
    tauri::menu::SubmenuBuilder::new(app, "Controls")
        .item(&menu_item(app, "play-pause", "Play / Pause", None)?)
        .item(&menu_item(app, "next", "Next", None)?)
        .item(&menu_item(app, "previous", "Previous", None)?)
        .build()
}

/// The icon by the clock (Windows' notification area), standing in for the Dock: Windows has no Dock, and a
/// window closed while the music plays needs a way back and a way to quit. A click on it brings the window back;
/// its menu does the rest. Its items carry a `tray-` prefix and are answered in on_menu_event.
#[cfg(target_os = "windows")]
fn tray_icon(app: &tauri::App) -> tauri::Result<()> {
    use tauri::menu::{MenuBuilder, MenuItemBuilder};
    use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
    let menu = MenuBuilder::new(app)
        .item(&MenuItemBuilder::with_id("tray-show-window", "Show Cassette").build(app)?)
        .separator()
        .item(&MenuItemBuilder::with_id("tray-play-pause", "Play / Pause").build(app)?)
        .item(&MenuItemBuilder::with_id("tray-next", "Next").build(app)?)
        .separator()
        .item(&MenuItemBuilder::with_id("tray-quit", "Quit Cassette").build(app)?)
        .build()?;
    let mut tray = TrayIconBuilder::with_id("cassette")
        .tooltip("Cassette")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, .. } = event {
                show_main_window(tray.app_handle());
            }
        });
    if let Some(icon) = app.default_window_icon() {
        tray = tray.icon(icon.clone());
    }
    tray.build(app)?;
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Persist Rust panics to disk before anything else can panic.
    install_panic_hook();

    tauri::Builder::default()
        // MUST be the first plugin (the plugin's contract): a second launch is
        // routed into this callback (show the running window, even one closed while
        // the music played) and then exits, so we never end up with two apps
        // double-spawning Navidrome on the same ports.
        .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            show_main_window(app);
        }))
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        // The feed decides what to offer: normally only a higher number, but a
        // pulled release is moved back to the last good one (BUG-790; the feed
        // route's `pulled` list). The signature check still guards every install,
        // and nothing below UPDATE_FLOOR is ever taken (BUG-870).
        .plugin(
            tauri_plugin_updater::Builder::new()
                .default_version_comparator(|current, remote| {
                    let v = &remote.version;
                    v != &current && update_allowed((v.major, v.minor, v.patch))
                })
                .build(),
        )
        .invoke_handler(tauri::generate_handler![
            pairing::clear_device_token,
            pairing::begin_pairing,
            add_music::add_music,
            check_for_update,
            install_update,
        ])
        .manage(Hub(Arc::new(Mutex::new(Vec::new()))))
        .menu(menu_bar)
        .on_menu_event(|app, event| {
            // The icon by the clock (Windows) sends the same ids as the menu bar, prefixed.
            let id = event.id().0.as_str();
            let id = id.strip_prefix("tray-").unwrap_or(id);
            // Windows' own Quit item (menu_bar): app.exit ends in RunEvent::Exit, which reaps the whole hub.
            if id == "quit" {
                app.exit(0);
                return;
            }
            // The Licenses folder opens in Finder from here; it needs no page.
            if id == "licenses" {
                use tauri_plugin_opener::OpenerExt;
                if let Ok(dir) = app.path().resource_dir() {
                    let _ = app.opener().open_path(dir.join("Licenses").to_string_lossy(), None::<&str>);
                }
                return;
            }
            // The logs folder too: it has to work when the page never loaded (BUG-782).
            if id == "show-logs" {
                use tauri_plugin_opener::OpenerExt;
                let dir = log_dir();
                let _ = std::fs::create_dir_all(&dir);
                let _ = app.opener().open_path(dir.to_string_lossy(), None::<&str>);
                return;
            }
            if id == "show-window" {
                show_main_window(app);
                return;
            }
            // The window may be closed with the music playing: an item answered on
            // the page (Settings, Search, Rip, a toast…) brings it back first.
            if !menu_item_works_hidden(id) {
                show_main_window(app);
            }
            // Before the page is up it can't answer Check for Updates; the shell does.
            if id == "update" && !UI_READY.load(Ordering::SeqCst) {
                shell_update_check(app.clone(), true);
                return;
            }
            // our own items only (the system's About, Hide, Quit, Copy… act by themselves)
            let _ = app.emit("cassette:menu", id);
        })
        .setup(|app| {
            // Closing the window (red button / Cmd+W) hides it and the music keeps
            // playing, the way Music.app does (the founder, 2026-10-28 audit Q4). It
            // used to quit, which stopped the music. The window is never destroyed,
            // so the page and the hub stay up; the Dock icon or opening Cassette
            // again brings it back (RunEvent::Reopen, the single-instance callback),
            // and so does Window > Cassette. Quitting is still Cmd+Q, the Cassette
            // menu's Quit, the Dock's Quit, logout or shutdown: every one of them ends
            // in RunEvent::Exit, which reaps the whole hub (the .run() handler below).
            //
            // The window takes the Mac's appearance (no theme is pinned in tauri.conf.json), and its own
            // background, the colour behind the page before it paints, follows it now and whenever it
            // changes; the pages follow it by themselves (prefers-color-scheme).
            #[cfg(target_os = "windows")]
            {
                if let Err(e) = tray_icon(app) {
                    eprintln!("[cassette] no icon by the clock: {e}");
                }
            }
            if let Some(main_window) = app.get_webview_window("main") {
                if let Ok(theme) = main_window.theme() {
                    let _ = main_window.set_background_color(Some(window_paper(theme)));
                }
                let app_handle = app.handle().clone();
                main_window.on_window_event(move |event| match event {
                    tauri::WindowEvent::CloseRequested { api, .. } => {
                        api.prevent_close();
                        hide_main_window(&app_handle);
                    }
                    tauri::WindowEvent::ThemeChanged(theme) => {
                        if let Some(w) = app_handle.get_webview_window("main") {
                            let _ = w.set_background_color(Some(window_paper(*theme)));
                        }
                    }
                    _ => {}
                });
            }

            // Dev/prod swap: if CASSETTE_UI_URL is set (e.g. http://localhost:3100),
            // point at that already-running dev server and DON'T spawn the bundled
            // one. Unset → serve the bundled UI locally. Only a debug build or
            // Cassette Dev.app reads the variable: in the shipped app anything that
            // could set it would get to choose the page the window trusts (BUG-784).
            let dev_build =
                cfg!(debug_assertions) || app.config().identifier.ends_with(".dev");
            let ui_override = std::env::var("CASSETTE_UI_URL")
                .ok()
                .filter(|_| dev_build)
                .map(|s| s.trim().trim_end_matches('/').to_string())
                .filter(|s| !s.is_empty())
                .or_else(|| {
                    // The separate "Cassette Dev.app" (identifier ….dev) defaults
                    // to the local dev server — a real double-clickable dev build,
                    // no env var + no bundled server. Prod id has no ".dev" suffix
                    // so this branch is inert there.
                    app.config()
                        .identifier
                        .ends_with(".dev")
                        .then(|| "http://localhost:3100".to_string())
                });
            let base = match ui_override {
                Some(dev) => {
                    eprintln!("[cassette] dev UI → {dev}");
                    dev
                }
                None => {
                    let (node, server_root, env_file) = resolve_paths(app);
                    reclaim_port(PORT);
                    match spawn_server(&node, &server_root, &env_file) {
                        Ok(child) => app.state::<Hub>().push("node", child),
                        Err(e) => eprintln!("[cassette] failed to spawn UI server: {e}"),
                    }
                    // Recipes the watchdog uses to bring any dead hub child back.
                    // The Node UI server is always supervised; the sidecar + audio
                    // helper join it when the bundled hub resolves below.
                    let mut recipes: Vec<Supervised> = Vec::new();
                    {
                        let (n, s, e) = (node.clone(), server_root.clone(), env_file.clone());
                        recipes.push(Supervised {
                            label: "node",
                            spawn: Box::new(move || {
                                reclaim_port(PORT);
                                spawn_server(&n, &s, &e)
                            }),
                        });
                    }
                    // Own the whole local hub in-app (the reconciliation): spawn the
                    // sidecar + Navidrome + the native audio helper here so that
                    // quitting Cassette reaps them too (reap_hub, RunEvent::Exit).
                    // Only the shipped bundled build does this; dev keeps a hand-run
                    // pair, so this branch never fires under `tauri dev`.
                    if let Some(paths) = resolve_hub_paths(app) {
                        for port in [5173u16, 4533, 4534, 5174] {
                            reclaim_port(port);
                        }
                        spawn_hub(&app.state::<Hub>(), &paths);
                        // Where music the person adds goes: the folder the hub watches.
                        if let Some((_, dir)) =
                            load_env_file(&paths.env_file).into_iter().find(|(k, _)| k == "SIDECAR_MUSIC_DIR")
                        {
                            #[cfg(target_os = "windows")]
                            let dir = expand_windows_env_tokens(&dir);
                            #[cfg(any(target_os = "linux", target_os = "macos"))]
                            let dir = expand_posix_env_tokens(&dir);
                            add_music::set_music_dir(PathBuf::from(dir));
                        }
                        // A signed-in app links its hub to the same account, so
                        // the phone can find this computer.
                        pairing::link_hub_in_background(5173);
                        let sc = paths.clone();
                        recipes.push(Supervised {
                            label: "sidecar",
                            spawn: Box::new(move || {
                                // A crashed sidecar can orphan Navidrome still
                                // holding 4534; clear the hub's ports and that one so
                                // the fresh sidecar can rebind and re-supervise it.
                                reclaim_port(5173);
                                reclaim_port(4533);
                                reclaim_port(4534);
                                let child = spawn_sidecar(&sc)?;
                                // The hub keeps its sign-in in memory only (BUG-859), so a restarted
                                // one waits for it again: hand it over, as at launch.
                                pairing::link_hub_in_background(5173);
                                Ok(child)
                            }),
                        });
                        // The audio helper is macOS only; Windows and Linux
                        // supervise just the Node UI server and the sidecar.
                        #[cfg(target_os = "macos")]
                        {
                            let au = paths.clone();
                            recipes.push(Supervised {
                                label: "audio",
                                spawn: Box::new(move || {
                                    reclaim_port(5174);
                                    spawn_audio(&au)
                                }),
                            });
                        }
                    }
                    // Keep the hub alive for the whole session: a mid-run crash of
                    // any child is restarted instead of silently killing playback.
                    start_hub_watchdog(app.state::<Hub>().inner().clone(), recipes);
                    warn_if_outside_applications(app.handle());
                    format!("http://localhost:{PORT}")
                }
            };
            // Landing path is normally LANDING; a dev build can override it
            // (e.g. CASSETTE_LANDING=/desk) to open straight to a specific page.
            // The shipped app ignores the variable (BUG-784).
            let landing = std::env::var("CASSETTE_LANDING")
                .ok()
                .filter(|_| dev_build)
                .map(|s| s.trim().to_string())
                .filter(|s| s.starts_with('/'))
                .unwrap_or_else(|| {
                    if app.config().identifier.ends_with(".dev") {
                        DEV_LANDING.to_string()
                    } else {
                        default_landing()
                    }
                });
            let target = format!("{base}{landing}");

            // Off the main thread: wait for the UI server, then swap the splash
            // for it. eval() runs on the webview's own thread. It keeps waiting for
            // as long as the app is open, since the watchdog may bring a slow or
            // crashed server up later; after a minute the splash says what is
            // wrong instead of spinning with no word (BUG-782).
            //
            // Something answering on the port is not proof it's Cassette: the window
            // grants the app's own permissions to whatever page it loads there, so the
            // bundled server's port must be held by Cassette's own program before the
            // window moves to it. Another program there is named on the splash at once.
            let bundled_ui = base == format!("http://localhost:{PORT}");
            let handle = app.handle().clone();
            std::thread::spawn(move || {
                let (host, port) =
                    host_port(&target).unwrap_or_else(|| ("127.0.0.1".to_string(), PORT));
                let start = Instant::now();
                let mut told = false;
                while !SHUTTING_DOWN.load(Ordering::SeqCst) {
                    if wait_ready_addr(&host, port, Duration::from_millis(500)) {
                        if bundled_ui && !port_is_ours(port) {
                            if !told {
                                told = true;
                                reclaim_port(port); // notes the holder; never stops it
                                let msg = conflict_message(&[port]).unwrap_or_else(|| {
                                    "Another program is using the connection Cassette's window needs. \
                                     Quit it, then reopen Cassette."
                                        .to_string()
                                });
                                show_on_splash(&handle, &msg);
                            }
                            std::thread::sleep(Duration::from_secs(1));
                            continue;
                        }
                        if let Some(win) = handle.get_webview_window("main") {
                            // Quoted as a JS string, so nothing in the address can
                            // become code (BUG-784).
                            let quoted = serde_json::to_string(&target).unwrap_or_default();
                            let _ = win.eval(&format!("location.replace({quoted})"));
                        }
                        UI_READY.store(true, Ordering::SeqCst);
                        warn_hub_port_conflicts(&handle);
                        return;
                    }
                    if !told && start.elapsed() >= SPLASH_PATIENCE {
                        told = true;
                        log_watchdog(&format!("UI not ready after {}s: {target}", SPLASH_PATIENCE.as_secs()));
                        let msg = conflict_message(&[PORT]).unwrap_or_else(|| {
                            "Cassette is taking longer than usual to start. It will keep trying. \
                             If this doesn't clear, Help > Show Logs has the details."
                                .to_string()
                        });
                        // A release whose window won't start can still be fixed by the next one.
                        shell_update_check(handle.clone(), false);
                        show_on_splash(&handle, &msg);
                    }
                }
            });

            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building the Cassette desktop shell")
        .run(|handle, event| match event {
            // The Dock icon (or opening Cassette again from Finder) brings back a
            // window that was closed while the music kept playing.
            #[cfg(target_os = "macos")]
            RunEvent::Reopen { .. } => show_main_window(handle),
            // Reap the WHOLE hub when the app quits — Node UI, sidecar, Navidrome
            // (via the sidecar's SIGTERM trap), and the audio helper — so nothing is
            // left running. This is the fix for "Cmd+Q on Cassette left Cassette
            // Player alive." Cmd+Q, the Dock's Quit, logout and shutdown reach here
            // through the Mac's terminate (applicationWillTerminate), app.exit()
            // and the updater's restart through the event loop's own exit.
            RunEvent::Exit => {
                // Tell the watchdog to stand down BEFORE reaping, so it can't
                // respawn a child into the shutdown we're executing.
                SHUTTING_DOWN.store(true, Ordering::SeqCst);
                if let Some(hub) = handle.try_state::<Hub>() {
                    reap_hub(&hub);
                }
            }
            _ => {}
        });
}

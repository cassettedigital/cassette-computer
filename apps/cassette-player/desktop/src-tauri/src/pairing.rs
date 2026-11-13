//! Desktop device-token pairing — the desktop half of the "stop bundling the
//! production database password" migration.
//!
//! The server half already exists (the phones use it): `/auth/player` +
//! `/api/player/auth-confirm` mint an opaque per-device bearer token and redirect
//! the system browser to `http://localhost:<port>/callback?token=…` (the
//! `cassette-player` slot is already in the server's redirect allow-list). This
//! module is the missing client side:
//!   - `begin_pairing` opens the browser to the approval page with a loopback
//!     `redirect_uri`, runs a one-shot HTTP listener on that ephemeral port, and
//!     captures the token from the redirect.
//!   - the token is stored in the OS secret store (macOS Keychain today; the same
//!     `keyring` crate covers Windows Credential Manager + Linux Secret Service
//!     when we port), NEVER on disk in the bundle.
//!
//! This is the prove-first slice: it establishes the token a paired client holds,
//! which the webview then sends to `/api/player/album/[slug]` instead of the app
//! reaching the database directly.

use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
use std::sync::OnceLock;
use std::time::{Duration, Instant};

use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine;
use tauri_plugin_opener::OpenerExt;

/// Keychain coordinates. Service matches the app identifier; the single account
/// name holds the current device token (one paired identity per install).
const KEYCHAIN_SERVICE: &str = "digital.cassette.desktop";
const KEYCHAIN_ACCOUNT: &str = "device-token";

/// How long to keep the loopback listener open waiting for the browser redirect
/// before giving up. Someone new signs up with their invite code and types the
/// code from their email first, which can take a while (BUG-868). The approval
/// page is told this deadline (`until`), so a browser that comes back after it
/// says to start again instead of landing on a dead page.
const PAIR_TIMEOUT: Duration = Duration::from_secs(30 * 60);

/// Where pairing may send the person to sign in: production, or a server on this
/// computer for a build made against a local one. The page asks for its cloud; it
/// can't send the person's sign-in anywhere else (BUG-870).
fn pairing_base_ok(base: &str) -> bool {
    let base = base.trim_end_matches('/');
    if base == "https://www.cassette.digital" {
        return true;
    }
    let Some(rest) = base.strip_prefix("http://localhost:").or_else(|| base.strip_prefix("http://127.0.0.1:")) else {
        return false;
    };
    !rest.is_empty() && rest.len() <= 5 && rest.bytes().all(|b| b.is_ascii_digit())
}

fn entry() -> Result<keyring::Entry, String> {
    keyring::Entry::new(KEYCHAIN_SERVICE, KEYCHAIN_ACCOUNT).map_err(|e| e.to_string())
}

/// `bytes` of OS randomness as lowercase hex.
fn random_hex(bytes: usize) -> String {
    let mut b = vec![0u8; bytes];
    getrandom::getrandom(&mut b).expect("the OS random source is unavailable");
    b.iter().map(|x| format!("{x:02x}")).collect()
}

/// This launch's key, shared with the hub and the audio helper through their
/// environment at spawn. Both sit on loopback where any web page in the person's
/// browser can reach them; a page can never learn this, so a request carrying it
/// came from the app (BUG-776, BUG-777). Fresh every launch, never stored.
pub fn local_key() -> &'static str {
    static KEY: OnceLock<String> = OnceLock::new();
    KEY.get_or_init(|| random_hex(32))
}

/// The device token if this install is paired, Ok(None) if it genuinely never
/// was, or Err if the OS secret store itself couldn't be reached (BUG-251).
/// That distinction matters: on Linux especially, a Secret Service D-Bus
/// daemon that isn't running (not auto-started under some window managers, or
/// gone right after a suspend/resume) used to collapse to the exact same
/// `None` as "never paired" - so a genuinely-paired user with a flaky
/// keyring backend saw an unexplained, repeating "pair this device" screen
/// with zero diagnostic. The shell's own read (landing, the UI server's spawn,
/// the hub link); no page can call it, since a script in the window holding
/// the token could take the account (BUG-784).
pub fn get_device_token() -> Result<Option<String>, String> {
    let e = entry()?;
    match e.get_password() {
        Ok(token) => Ok(Some(token)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(err) => Err(err.to_string()),
    }
}

/// Forget the paired identity (sign out / unpair locally). Deleting a token that
/// isn't there is success, not an error.
///
/// A shipped build's UI server only reads the token at spawn, so forgetting it
/// alone left the window signed in until the next launch (BUG-605). Start over,
/// as pairing does: the fresh launch finds no token and opens /desktop/connect.
/// A dev build runs on the dev server's session and stays put.
#[tauri::command]
pub fn clear_device_token(#[allow(unused)] app: tauri::AppHandle) -> Result<(), String> {
    match entry()?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => {}
        Err(e) => return Err(e.to_string()),
    }
    #[cfg(not(debug_assertions))]
    crate::relaunch(&app);
    #[allow(unreachable_code)]
    Ok(())
}

/// Open the approval page in the system browser and capture the token it redirects
/// back with, then store it in the keychain. `base_url` is the cloud origin that
/// owns the session + mints the token (`https://www.cassette.digital` shipped, or
/// the local dev server when developing). Returns Ok(()) on success; the webview
/// starts again signed in.
#[tauri::command]
pub async fn begin_pairing(app: tauri::AppHandle, base_url: String) -> Result<(), String> {
    if !pairing_base_ok(&base_url) {
        return Err(format!("refused to pair against {base_url}: not Cassette's cloud"));
    }
    // Bind an ephemeral loopback port for the redirect target. The server's
    // allow-list accepts any `http://localhost:<port>/callback`.
    let listener = TcpListener::bind("127.0.0.1:0").map_err(|e| e.to_string())?;
    listener.set_nonblocking(true).map_err(|e| e.to_string())?;
    let port = listener.local_addr().map_err(|e| e.to_string())?.port();
    let redirect_uri = format!("http://localhost:{port}/callback");
    // A one-time code the cloud hands back beside the token. Anything else that
    // finds this port while it waits can't produce it, so it can't sign the app
    // into another account (BUG-776).
    let state = random_hex(24);
    let until = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| (d + PAIR_TIMEOUT).as_secs())
        .unwrap_or(0);

    // A fresh key pair for this pairing alone: the cloud seals the token to its public half, so the address the
    // browser comes back to (and keeps in its history) holds nothing anyone else could use (BUG-859).
    let rng = ring::rand::SystemRandom::new();
    let private = ring::agreement::EphemeralPrivateKey::generate(&ring::agreement::X25519, &rng)
        .map_err(|_| "couldn't make a pairing key".to_string())?;
    let public = private
        .compute_public_key()
        .map_err(|_| "couldn't make a pairing key".to_string())?
        .as_ref()
        .to_vec();
    let key = URL_SAFE_NO_PAD.encode(&public);

    let auth_url = format!(
        "{base}/auth/player?client=cassette-player&redirect_uri={redirect}&state={state}&until={until}&key={key}",
        base = base_url.trim_end_matches('/'),
        redirect = percent_encode(&redirect_uri),
    );

    app.opener()
        .open_url(auth_url, None::<&str>)
        .map_err(|e| format!("couldn't open the browser: {e}"))?;

    // Wait for the one redirect on a blocking thread so we don't stall the async
    // runtime. Returns what came back, or None on timeout.
    let reply = tauri::async_runtime::spawn_blocking(move || wait_for_callback(listener, &state))
        .await
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "pairing timed out — no token received".to_string())?;
    let token = match reply {
        Reply::Sealed(sealed) => open_sealed(private, &public, &sealed).ok_or("couldn't open the sign-in")?,
        // A cloud from before sealing; still checked against this pairing's code.
        Reply::Token(token) => token,
    };

    entry()?
        .set_password(&token)
        .map_err(|e| format!("couldn't store the token: {e}"))?;
    // A shipped build's UI server only picks the token up at spawn, so start over
    // signed in. A dev build runs on the dev server's session and stays put.
    #[cfg(not(debug_assertions))]
    crate::relaunch(&app);
    #[allow(unreachable_code)]
    Ok(())
}


/// Sign the bundled hub in with this device's token, once the app itself is signed
/// in. The hub (the Go sidecar) holds its own account link: it is what registers
/// this computer's LAN address and the phone's playback login with the cloud, so a
/// hub that never links leaves the phone with "No Cassette Player found". Before
/// this, the only way in was a page at localhost:<port> nobody was told about. The
/// hub's /callback is the same one that page's browser round trip lands on, so
/// handing it the token here is that round trip without the browser, vouched for
/// with this launch's key. Release builds only; runs on its own thread and only logs.
pub fn link_hub_in_background(sidecar_port: u16) {
    std::thread::spawn(move || {
        let Ok(Some(token)) = get_device_token() else {
            return;
        };
        // Navidrome can take a while on a first start; the sidecar's server comes
        // up after it.
        let deadline = Instant::now() + Duration::from_secs(150);
        while local_get(sidecar_port, "/status.json", None).is_none() {
            if Instant::now() > deadline {
                eprintln!("[cassette] hub link: hub never answered on :{sidecar_port}");
                return;
            }
            std::thread::sleep(Duration::from_secs(2));
        }
        // Sent even to a paired hub: it ignores the sign-in it already holds, and
        // takes a new one (after Sign out, or another account) and restarts on it.
        let path = format!("/callback?token={}", percent_encode(&token));
        // The hub only takes a sign-in that carries this launch's key (BUG-776).
        match local_get(sidecar_port, &path, Some(local_key())) {
            Some(_) => eprintln!("[cassette] hub link: handed the hub this device's sign-in"),
            None => eprintln!("[cassette] hub link: the hub didn't answer the sign-in"),
        }
    });
}

/// A plain HTTP/1.0 GET to 127.0.0.1:<port>, returning the body. The sidecar
/// always answers plain HTTP on its port, even when it also serves HTTPS.
/// `key` adds this launch's key (see `local_key`).
fn local_get(port: u16, path: &str, key: Option<&str>) -> Option<String> {
    let mut stream = TcpStream::connect(("127.0.0.1", port)).ok()?;
    stream.set_read_timeout(Some(Duration::from_secs(60))).ok()?;
    stream.set_write_timeout(Some(Duration::from_secs(5))).ok()?;
    let key_line = key.map(|k| format!("X-Cassette-Local-Key: {k}\r\n")).unwrap_or_default();
    write!(stream, "GET {path} HTTP/1.0\r\nHost: localhost\r\n{key_line}Connection: close\r\n\r\n").ok()?;
    let mut raw = String::new();
    stream.read_to_string(&mut raw).ok()?;
    let (head, body) = raw.split_once("\r\n\r\n")?;
    head.starts_with("HTTP/1.").then(|| body.to_string())
}

/// Accept exactly one `GET /callback?token=…&state=<ours>` and return the token.
/// Anything else (favicon, a token without our code) is answered and ignored, so
/// a stray or forged request can't end the wait or sign us in. Times out after
/// `PAIR_TIMEOUT`.
fn wait_for_callback(listener: TcpListener, state: &str) -> Option<Reply> {
    let deadline = Instant::now() + PAIR_TIMEOUT;
    while Instant::now() < deadline {
        match listener.accept() {
            Ok((mut stream, _)) => {
                let mut buf = [0u8; 4096];
                let n = stream.read(&mut buf).unwrap_or(0);
                let req = String::from_utf8_lossy(&buf[..n]);
                let token = parse_callback(&req, state);
                let body = if token.is_some() {
                    "<!doctype html><meta charset=utf-8><title>Cassette</title>\
                     <body style=\"font:16px system-ui;padding:3rem;text-align:center\">\
                     <h1>Paired</h1><p>You can close this tab and return to Cassette.</p>"
                } else {
                    "<!doctype html><meta charset=utf-8><title>Cassette</title>\
                     <body style=\"font:16px system-ui;padding:3rem;text-align:center\">\
                     <h1>Waiting…</h1><p>Return to Cassette to finish pairing.</p>"
                };
                let resp = format!(
                    "HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\n\
                     Content-Length: {}\r\nConnection: close\r\n\r\n{}",
                    body.len(),
                    body
                );
                let _ = stream.write_all(resp.as_bytes());
                let _ = stream.flush();
                if token.is_some() {
                    return token;
                }
            }
            Err(ref e) if e.kind() == std::io::ErrorKind::WouldBlock => {
                std::thread::sleep(Duration::from_millis(150));
            }
            Err(_) => return None,
        }
    }
    None
}

/// The token from a `GET /callback?token=…&state=…` request line, only when the
/// path is exactly /callback and the state is the one this pairing sent out.
fn parse_callback(req: &str, state: &str) -> Option<Reply> {
    let first = req.lines().next()?; // e.g. "GET /callback?token=abc&state=… HTTP/1.1"
    let target = first.split_whitespace().nth(1)?;
    let (path, query) = target.split_once('?')?;
    if path != "/callback" {
        return None;
    }
    let mut reply = None;
    let mut got_state = None;
    for pair in query.split('&') {
        if let Some(v) = pair.strip_prefix("token=") {
            reply = Some(Reply::Token(percent_decode(v)));
        } else if let Some(v) = pair.strip_prefix("sealed=") {
            reply = Some(Reply::Sealed(percent_decode(v)));
        } else if let Some(v) = pair.strip_prefix("state=") {
            got_state = Some(percent_decode(v));
        }
    }
    let same = got_state.is_some_and(|g| {
        g.len() == state.len() && g.bytes().zip(state.bytes()).fold(0, |acc, (a, b)| acc | (a ^ b)) == 0
    });
    reply.filter(|r| same && !state.is_empty() && !r.value().is_empty())
}

/// What the browser brought back: the token sealed to this pairing's key, or (from a cloud older than sealing) the
/// token itself.
#[derive(Debug, PartialEq)]
enum Reply {
    Token(String),
    Sealed(String),
}

impl Reply {
    fn value(&self) -> &str {
        match self {
            Reply::Token(v) | Reply::Sealed(v) => v,
        }
    }
}

/// Open the cloud's sealed token with this pairing's private key: base64url( the cloud's public key (32) | nonce
/// (12) | AES-256-GCM ciphertext and tag ), keyed by HKDF-SHA256 over the X25519 shared secret, salted with both
/// public keys, info "cassette-pairing-v1". The cloud seals it the same way (apps/cassette/src/lib/pairing-seal.ts);
/// change one, change both.
fn open_sealed(private: ring::agreement::EphemeralPrivateKey, public: &[u8], sealed: &str) -> Option<String> {
    use ring::{aead, agreement, hkdf};
    let raw = URL_SAFE_NO_PAD.decode(sealed).ok()?;
    if raw.len() < 32 + 12 + 16 {
        return None;
    }
    let (server, rest) = raw.split_at(32);
    let (nonce, body) = rest.split_at(12);
    let peer = agreement::UnparsedPublicKey::new(&agreement::X25519, server);
    let key = agreement::agree_ephemeral(private, &peer, |shared| {
        let salt = hkdf::Salt::new(hkdf::HKDF_SHA256, &[server, public].concat());
        let prk = salt.extract(shared);
        let okm = prk.expand(&[b"cassette-pairing-v1"], &aead::AES_256_GCM).ok()?;
        Some(aead::LessSafeKey::new(aead::UnboundKey::from(okm)))
    })
    .ok()??;
    let nonce = aead::Nonce::try_assume_unique_for_key(nonce).ok()?;
    let mut in_out = body.to_vec();
    let plain = key.open_in_place(nonce, aead::Aad::empty(), &mut in_out).ok()?;
    String::from_utf8(plain.to_vec()).ok().filter(|t| !t.is_empty())
}

/// Percent-encode a string for a query value (RFC 3986 unreserved set kept raw).
fn percent_encode(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for b in s.bytes() {
        match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                out.push(b as char)
            }
            _ => out.push_str(&format!("%{b:02X}")),
        }
    }
    out
}

/// Decode percent-escapes (and `+` as space) in a query value.
fn percent_decode(s: &str) -> String {
    let bytes = s.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        match bytes[i] {
            b'%' if i + 3 <= bytes.len() => match u8::from_str_radix(&s[i + 1..i + 3], 16) {
                Ok(v) => {
                    out.push(v);
                    i += 3;
                }
                Err(_) => {
                    out.push(bytes[i]);
                    i += 1;
                }
            },
            b'+' => {
                out.push(b' ');
                i += 1;
            }
            c => {
                out.push(c);
                i += 1;
            }
        }
    }
    String::from_utf8_lossy(&out).into_owned()
}

#[cfg(test)]
mod tests {
    use super::*;

    const STATE: &str = "0123456789abcdef0123";

    /// The cloud's side of sealing (apps/cassette/src/lib/pairing-seal.ts sealToken), in Rust for the round trip.
    fn seal_like_the_cloud(token: &str, app_public: &[u8]) -> String {
        use ring::{aead, agreement, hkdf, rand::SecureRandom};
        let rng = ring::rand::SystemRandom::new();
        let mine = agreement::EphemeralPrivateKey::generate(&agreement::X25519, &rng).unwrap();
        let server = mine.compute_public_key().unwrap().as_ref().to_vec();
        let peer = agreement::UnparsedPublicKey::new(&agreement::X25519, app_public);
        let key = agreement::agree_ephemeral(mine, &peer, |shared| {
            let salt = hkdf::Salt::new(hkdf::HKDF_SHA256, &[&server[..], app_public].concat());
            let prk = salt.extract(shared);
            let okm = prk.expand(&[b"cassette-pairing-v1"], &aead::AES_256_GCM).unwrap();
            aead::LessSafeKey::new(aead::UnboundKey::from(okm))
        })
        .unwrap();
        let mut nonce = [0u8; 12];
        rng.fill(&mut nonce).unwrap();
        let mut body = token.as_bytes().to_vec();
        key.seal_in_place_append_tag(aead::Nonce::assume_unique_for_key(nonce), aead::Aad::empty(), &mut body).unwrap();
        URL_SAFE_NO_PAD.encode([&server[..], &nonce[..], &body[..]].concat())
    }

    fn pairing_keys() -> (ring::agreement::EphemeralPrivateKey, Vec<u8>) {
        let rng = ring::rand::SystemRandom::new();
        let private = ring::agreement::EphemeralPrivateKey::generate(&ring::agreement::X25519, &rng).unwrap();
        let public = private.compute_public_key().unwrap().as_ref().to_vec();
        (private, public)
    }

    // BUG-859: the token comes back sealed to this pairing's key, and only that key opens it.
    #[test]
    fn a_sealed_sign_in_opens_only_with_its_own_key() {
        let (private, public) = pairing_keys();
        let sealed = seal_like_the_cloud("tok_abc-123", &public);
        assert_eq!(open_sealed(private, &public, &sealed).as_deref(), Some("tok_abc-123"));

        let (other, other_public) = pairing_keys();
        assert_eq!(open_sealed(other, &other_public, &sealed), None);

        let (private, public) = pairing_keys();
        let mut raw = URL_SAFE_NO_PAD.decode(seal_like_the_cloud("tok", &public)).unwrap();
        *raw.last_mut().unwrap() ^= 1;
        assert_eq!(open_sealed(private, &public, &URL_SAFE_NO_PAD.encode(raw)), None);
    }

    // The cloud's own sealing code, run for real: `cargo test -- --ignored cloud_seals` (needs node and pnpm, and
    // Cassette's own repository: the open-source copy has the app's half only, so there it says so and stops).
    #[test]
    #[ignore]
    fn cloud_seals_what_the_app_opens() {
        let (private, public) = pairing_keys();
        let seal = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../../cassette/src/lib/pairing-seal.ts");
        if !seal.exists() {
            eprintln!("skipped: the cloud's sealing code isn't in this copy");
            return;
        }
        let script = format!(
            "import {{ sealToken }} from {:?}; process.stdout.write(sealToken('tok_from_node', {:?}));",
            seal.canonicalize().unwrap().to_string_lossy(),
            URL_SAFE_NO_PAD.encode(&public)
        );
        let out = std::process::Command::new("pnpm")
            .args(["dlx", "tsx", "--eval", &script])
            .output()
            .expect("pnpm runs");
        let sealed = String::from_utf8(out.stdout).unwrap();
        assert_eq!(open_sealed(private, &public, sealed.trim()).as_deref(), Some("tok_from_node"), "{}", String::from_utf8_lossy(&out.stderr));
    }

    // BUG-870: the page names the cloud, but only Cassette's or one on this computer is taken.
    #[test]
    fn pairs_only_against_cassettes_cloud() {
        assert!(pairing_base_ok("https://www.cassette.digital"));
        assert!(pairing_base_ok("https://www.cassette.digital/"));
        assert!(pairing_base_ok("http://localhost:3100"));
        assert!(pairing_base_ok("http://127.0.0.1:3100"));
        assert!(!pairing_base_ok("https://evil.test"));
        assert!(!pairing_base_ok("https://www.cassette.digital.evil.test"));
        assert!(!pairing_base_ok("http://localhost:3100@evil.test"));
        assert!(!pairing_base_ok("http://localhost:"));
        assert!(!pairing_base_ok("http://www.cassette.digital"));
    }

    #[test]
    fn parses_token_from_callback() {
        let req = format!("GET /callback?token=abc123-_&state={STATE} HTTP/1.1\r\nHost: localhost\r\n\r\n");
        assert_eq!(parse_callback(&req, STATE), Some(Reply::Token("abc123-_".to_string())));
        let sealed = format!("GET /callback?sealed=AbC_-9&state={STATE} HTTP/1.1\r\n\r\n");
        assert_eq!(parse_callback(&sealed, STATE), Some(Reply::Sealed("AbC_-9".to_string())));
    }

    #[test]
    fn ignores_paths_without_token() {
        assert_eq!(parse_callback("GET /favicon.ico HTTP/1.1\r\n\r\n", STATE), None);
        assert_eq!(parse_callback(&format!("GET /callback?state={STATE} HTTP/1.1\r\n\r\n"), STATE), None);
    }

    // BUG-776: a token that didn't come back with our code, or on another path,
    // never signs the app in.
    #[test]
    fn refuses_a_token_without_our_code() {
        assert_eq!(parse_callback("GET /callback?token=forged HTTP/1.1\r\n\r\n", STATE), None);
        let wrong = "GET /callback?token=forged&state=0123456789abcdef0124 HTTP/1.1\r\n\r\n";
        assert_eq!(parse_callback(wrong, STATE), None);
        let elsewhere = format!("GET /x?token=forged&state={STATE} HTTP/1.1\r\n\r\n");
        assert_eq!(parse_callback(&elsewhere, STATE), None);
        assert_eq!(parse_callback("GET /callback?token=t&state= HTTP/1.1\r\n\r\n", ""), None);
    }

    #[test]
    fn local_key_is_random_and_stable_for_the_launch() {
        assert_eq!(local_key().len(), 64);
        assert_eq!(local_key(), local_key());
        assert_ne!(random_hex(24), random_hex(24));
    }

    #[test]
    fn roundtrips_percent_coding() {
        let uri = "http://localhost:52341/callback";
        assert_eq!(percent_decode(&percent_encode(uri)), uri);
    }
}

//! Adding music from the person's own folders into the hub's music folder (BUG-868; the founder, 2026-11-06:
//! "I honestly prefer when files get moved instead of copied - can we make that something it asks about on first
//! copy?"). The page asks once, Move or Copy, remembers the answer, and calls `add_music` with it. The work is done
//! here because only the app knows where a dropped or picked file lives: a web page gets its bytes, never its path.
//! The hub watches its music folder and takes it from there.
//!
//! The rules: nothing already there is overwritten, the music folder can't be moved into itself, a copy (or a move
//! to another disk) first checks there is room for it, a copy keeps the file's Finder tags and dates (the system's
//! own copy), and a move to another disk removes each original only after its copy is safely written.
//!
//! Where things land: every song is filed the way a CD rip is, by its own tags, in <Album Artist>/<Album>/ under
//! its own file name (`tag_folder`), so the two discs of a record meet in one folder; the covers, booklets and .cue
//! files beside the songs go with them (`file_by_tags`). A song whose tags don't name its album lands where it
//! always did: a dropped folder keeps its own name, and loose files (picked one by one, or dropped without their
//! folder) go into a folder named for the one they came from (`folder_for_loose`), never loose in the top of the
//! music folder. A song whose name is already taken is either the very same file, left as it is, or a different
//! song, which goes in beside it as "<name> 2" (`place`), so nobody's song is ever skipped unseen.
//!
//! The window counts along: after every song the app says how far it has got (`PROGRESS_EVENT`).

use std::collections::HashMap;
use std::ffi::OsString;
use std::fs;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::sync::OnceLock;

use tauri::Emitter;

static MUSIC_DIR: OnceLock<PathBuf> = OnceLock::new();

/// The hub's music folder, read from its settings when the app starts it (lib.rs).
pub fn set_music_dir(dir: PathBuf) {
    let _ = MUSIC_DIR.set(dir);
}

const AUDIO: &[&str] = &[
    "flac", "mp3", "m4a", "aac", "alac", "wav", "aif", "aiff", "ogg", "oga", "opus", "wma", "ape", "wv", "dsf", "dff",
];

/// Room left on the disk beyond what a copy needs, so adding music never fills the computer to the last byte.
const SPARE_BYTES: u64 = 1 << 30;

#[derive(serde::Serialize, Default, Debug)]
pub struct AddReport {
    /// Music files now in the music folder because of this add.
    added: u32,
    /// Already there, the very same file; left alone.
    already: u32,
    /// Couldn't be added; `error` says why for the first one.
    failed: u32,
    error: Option<String>,
}

impl AddReport {
    fn progress(&self, done: u32, total: u32) -> AddProgress {
        AddProgress { done, total, added: self.added, already: self.already, failed: self.failed }
    }
}

/// The event the window listens to while an add runs, sent after every song.
pub const PROGRESS_EVENT: &str = "add-music-progress";

/// How far an add has got: `done` of the `total` songs it set out to add, and how each went so far.
#[derive(serde::Serialize, Clone, Copy, Default, Debug, PartialEq)]
pub struct AddProgress {
    done: u32,
    total: u32,
    added: u32,
    already: u32,
    failed: u32,
}

/// Where loose files go when the folder they came from says nothing about them.
const ADDED_MUSIC: &str = "Added music";

/// Folders that are a place on the computer, not a record: loose files from these go into `ADDED_MUSIC`.
const GENERIC_PLACES: &[&str] = &["desktop", "downloads", "documents", "music", "com~apple~clouddocs"];

/// One thing the person handed over: a folder with the files inside it, or the loose files they handed over from
/// one folder (`src` is then that folder). Each file is (source, path under the music folder, size).
struct Item {
    src: PathBuf,
    files: Vec<(PathBuf, PathBuf, u64)>,
    is_dir: bool,
}

/// The folders a CD rip makes when its tags are missing (rip.go albumDir); here only when the other one is known.
const UNKNOWN_ARTIST: &str = "Unknown Artist";
const UNKNOWN_ALBUM: &str = "Unknown Album";

/// The longest an artist or album folder's name gets, in characters and in bytes: a Mac allows 255 bytes in a
/// name, Windows 260 characters in a whole path unless long paths are on.
const NAME_CHARS: usize = 120;
const NAME_BYTES: usize = 240;

/// What a song's own tags say about the record it is on; each is None when the tags don't say.
#[derive(Default, Debug, Clone, PartialEq)]
struct SongTags {
    album_artist: Option<String>,
    artist: Option<String>,
    album: Option<String>,
}

/// The song's tags, read without its pictures or its sound (the main tag first, then any other the file carries).
/// A file that can't be read, isn't one lofty knows, or has no tags gives back nothing, and the song lands by its
/// folder as before: reading a tag never stops an add, a damaged file included.
fn read_tags(path: &Path) -> SongTags {
    use lofty::config::{ParseOptions, ParsingMode};
    use lofty::file::TaggedFileExt;
    use lofty::probe::Probe;
    use lofty::tag::{ItemKey, Tag};

    let read = || -> Option<SongTags> {
        let options =
            ParseOptions::new().read_properties(false).read_cover_art(false).parsing_mode(ParsingMode::Relaxed);
        let file = Probe::open(path).ok()?.options(options).guess_file_type().ok()?.read().ok()?;
        let primary = file.primary_tag();
        let tags: Vec<&Tag> = primary
            .into_iter()
            .chain(file.tags().iter().filter(|t| !primary.is_some_and(|p| std::ptr::eq(*t, p))))
            .collect();
        let first = |key: ItemKey| {
            tags.iter().find_map(|t| t.get_string(key).map(str::trim).filter(|v| !v.is_empty()).map(String::from))
        };
        Some(SongTags {
            album_artist: first(ItemKey::AlbumArtist),
            artist: first(ItemKey::TrackArtist),
            album: first(ItemKey::AlbumTitle),
        })
    };
    std::panic::catch_unwind(std::panic::AssertUnwindSafe(read)).ok().flatten().unwrap_or_default()
}

/// A tag as an artist or album folder's name, the way a CD rip names its folders (rip.go folderName, so a rip
/// and an add of the same record share one folder): spaces and control characters off the ends and out, the
/// characters a Mac or Windows won't take in a name swapped (/ \ : * | for "-", " for ', < > for ( ), ? dropped),
/// no dot or space at either end, at most `NAME_CHARS` characters, and on Windows never a name it keeps for a
/// device. Empty when nothing usable is left.
fn folder_name(tag: &str) -> String {
    folder_name_for(tag, cfg!(windows))
}

/// `folder_name`, saying whether Windows' device names are kept clear of (on Windows only, as rips do: on a Mac a
/// folder called "Con" is fine, and the rips already there are named that way).
fn folder_name_for(tag: &str, windows: bool) -> String {
    let ends = |c: char| c == '.' || c == ' ';
    let mut swapped = String::with_capacity(tag.len());
    for c in tag.trim().chars().filter(|c| !c.is_control()) {
        match c {
            '/' | '\\' | ':' | '*' | '|' => swapped.push('-'),
            '?' => {}
            '"' => swapped.push('\''),
            '<' => swapped.push('('),
            '>' => swapped.push(')'),
            c => swapped.push(c),
        }
    }
    let mut name = String::new();
    for (i, c) in swapped.trim_matches(ends).chars().enumerate() {
        if i == NAME_CHARS || name.len() + c.len_utf8() > NAME_BYTES {
            break;
        }
        name.push(c);
    }
    let name = name.trim_matches(ends).to_string();
    if windows {
        avoid_windows_device_name(name)
    } else {
        name
    }
}

/// `name` with "_" added when Windows keeps it for a device (CON, PRN, AUX, NUL, CONIN$, CONOUT$, COM0-9, LPT0-9,
/// COM and LPT with a superscript 1-3), in any case and with or without an extension, which Windows ignores:
/// "Nul.Live" is NUL too, so the mark goes before the first dot (rip.go avoidWindowsDeviceName).
fn avoid_windows_device_name(name: String) -> String {
    let (stem, rest) = name.split_at(name.find('.').unwrap_or(name.len()));
    let stem = stem.trim_end_matches(' ');
    if !is_windows_device_name(stem) {
        return name;
    }
    format!("{stem}_{rest}")
}

fn is_windows_device_name(stem: &str) -> bool {
    let upper = stem.to_uppercase();
    if ["CON", "PRN", "AUX", "NUL", "CONIN$", "CONOUT$"].contains(&upper.as_str()) {
        return true;
    }
    let c: Vec<char> = upper.chars().collect();
    c.len() == 4
        && (c[..3] == ['C', 'O', 'M'] || c[..3] == ['L', 'P', 'T'])
        && (c[3].is_ascii_digit() || ['¹', '²', '³'].contains(&c[3]))
}

/// The folder under the music folder a song is filed in by its tags, as a CD rip is: "<Album Artist>/<Album>",
/// the song's artist when it names no album artist, "Unknown Artist" when it names an album and no artist. None
/// when the tags name no album, or nothing a folder can be called: the song then lands by its folder, as before.
fn tag_folder(tags: &SongTags) -> Option<PathBuf> {
    let album = tags.album.as_deref().filter(|a| !a.trim().is_empty())?;
    let album = folder_name(album);
    let artist = [&tags.album_artist, &tags.artist]
        .into_iter()
        .flatten()
        .map(|a| folder_name(a))
        .find(|a| !a.is_empty())
        .unwrap_or_default();
    if album.is_empty() && artist.is_empty() {
        return None;
    }
    let or = |name: String, unknown: &str| if name.is_empty() { unknown.to_string() } else { name };
    Some(Path::new(&or(artist, UNKNOWN_ARTIST)).join(or(album, UNKNOWN_ALBUM)))
}

/// The files of one thing the person handed over, filed by their tags. Each comes with the place it would have had
/// before (`plan`: its folder's name and the tree inside it, or `folder_for_loose`). A song whose tags name its
/// album goes to "<Album Artist>/<Album>/<its own file name>" (`tag_folder`, `tags` reads them), out of whatever
/// folders it sat in, so the discs of a record meet; one whose tags don't keeps its old place.
///
/// Anything that isn't a song (a cover, a booklet, a .cue or .log, a folder of scans) goes with the songs: to the
/// record most of the songs in its own folder went to, under its own name. When its folder has no songs of its own
/// (a cover on top of CD1/ and CD2/, a Scans/ folder), to the record most of the songs under the nearest folder
/// above it went to, keeping its path below that folder, so "Scans/back.jpg" lands as "<record>/Scans/back.jpg"
/// (`root`, the folder handed over or the one loose files came from, is as far up as it looks). A tie goes to the
/// first by name. For an untagged song the record is its old place, so a folder of untagged songs keeps its whole
/// tree, covers and scans included, as before; one with no songs anywhere in it sends nothing.
fn file_by_tags(
    root: &Path,
    files: Vec<(PathBuf, PathBuf, u64)>,
    tags: &dyn Fn(&Path) -> SongTags,
) -> Vec<(PathBuf, PathBuf, u64)> {
    // For each folder: where the record of each song directly in it went, and of each song anywhere under it.
    let mut direct: HashMap<PathBuf, HashMap<PathBuf, u32>> = HashMap::new();
    let mut under: HashMap<PathBuf, HashMap<PathBuf, u32>> = HashMap::new();
    let mut out = Vec::with_capacity(files.len());
    let mut others = Vec::new();
    for (src, old, size) in files {
        if !is_audio(&src) {
            others.push((src, size));
            continue;
        }
        let record = tag_folder(&tags(&src));
        let dest = match (&record, src.file_name()) {
            (Some(folder), Some(name)) => folder.join(name),
            _ => old.clone(),
        };
        if let (Some(from), Some(old_dir)) = (src.parent(), old.parent()) {
            for (up, dir) in from.ancestors().take_while(|d| d.starts_with(root)).enumerate() {
                // An untagged song keeps the tree it came in, so seen from `up` folders above it, its record is
                // that folder's old place.
                let Some(went) = record.clone().or_else(|| old_dir.ancestors().nth(up).map(Path::to_path_buf)) else {
                    break;
                };
                if up == 0 {
                    *direct.entry(dir.to_path_buf()).or_default().entry(went.clone()).or_default() += 1;
                }
                *under.entry(dir.to_path_buf()).or_default().entry(went).or_default() += 1;
            }
        }
        out.push((src, dest, size));
    }
    let most = |votes: &HashMap<PathBuf, u32>| {
        votes.iter().max_by(|a, b| a.1.cmp(b.1).then_with(|| b.0.cmp(a.0))).map(|(dir, _)| dir.clone())
    };
    for (src, size) in others {
        let Some(from) = src.parent() else { continue };
        let follow = match direct.get(from) {
            Some(votes) => Some((from, votes)),
            None => from.ancestors().take_while(|d| d.starts_with(root)).find_map(|d| under.get(d).map(|v| (d, v))),
        };
        let Some((dir, votes)) = follow else { continue };
        if let (Some(record), Ok(below)) = (most(votes), src.strip_prefix(dir)) {
            out.push((src.clone(), record.join(below), size));
        }
    }
    out
}

fn is_audio(p: &Path) -> bool {
    p.extension()
        .and_then(|e| e.to_str())
        .is_some_and(|e| AUDIO.contains(&e.to_ascii_lowercase().as_str()))
}

fn hidden(p: &Path) -> bool {
    p.file_name()
        .is_some_and(|n| n.to_str().is_some_and(|n| n.starts_with('.')) || crate::win::system_file(n))
}

/// Every regular file under `dir`, hidden ones and links left out, as (source, path under the folder, size).
fn walk(dir: &Path, rel: &Path, out: &mut Vec<(PathBuf, PathBuf, u64)>) -> std::io::Result<()> {
    for entry in fs::read_dir(dir)? {
        let entry = entry?;
        let path = entry.path();
        if hidden(&path) {
            continue;
        }
        let meta = fs::symlink_metadata(&path)?;
        let rel = rel.join(entry.file_name());
        if meta.is_dir() {
            walk(&path, &rel, out)?;
        } else if meta.is_file() {
            out.push((path, rel, meta.len()));
        }
    }
    Ok(())
}

#[cfg(unix)]
fn same_disk(a: &Path, b: &Path) -> bool {
    use std::os::unix::fs::MetadataExt;
    match (fs::metadata(a), fs::metadata(b)) {
        (Ok(x), Ok(y)) => x.dev() == y.dev(),
        _ => false,
    }
}

#[cfg(windows)]
fn same_disk(a: &Path, b: &Path) -> bool {
    crate::win::same_disk(a, b)
}

#[cfg(not(any(unix, windows)))]
fn same_disk(_a: &Path, _b: &Path) -> bool {
    false
}

#[cfg(unix)]
fn free_bytes(dir: &Path) -> Option<u64> {
    use std::os::unix::ffi::OsStrExt;
    let c = std::ffi::CString::new(dir.as_os_str().as_bytes()).ok()?;
    let mut s: libc::statvfs = unsafe { std::mem::zeroed() };
    (unsafe { libc::statvfs(c.as_ptr(), &mut s) } == 0).then(|| s.f_bavail as u64 * s.f_frsize as u64)
}

#[cfg(windows)]
fn free_bytes(dir: &Path) -> Option<u64> {
    crate::win::free_bytes(dir)
}

#[cfg(not(any(unix, windows)))]
fn free_bytes(_dir: &Path) -> Option<u64> {
    None
}

fn gb(bytes: u64) -> String {
    format!("{:.1} GB", bytes as f64 / 1e9)
}

/// One word of a folder's name that says how the music is stored or which disc it is, never what it is.
fn format_token(t: &str) -> bool {
    let all_digits = |n: &str| !n.is_empty() && n.bytes().all(|b| b.is_ascii_digit());
    // a number with a unit after it: "320k", "320kbps", "24bit", "96khz"
    let lead = t.trim_end_matches(|c: char| c.is_ascii_alphabetic());
    let measured = all_digits(lead) && ["k", "kbps", "khz", "bit", "bits"].contains(&&t[lead.len()..]);
    AUDIO.contains(&t)
        || ["mp3s", "v0", "v1", "v2", "vbr", "cbr", "kbps", "khz", "bit", "cd", "disc", "disk"].contains(&t)
        || ["cd", "disc", "disk"].iter().any(|w| t.strip_prefix(w).is_some_and(all_digits))
        || measured
}

/// A folder named only for its format or its disc ("MP3", "FLAC", "320", "V0", "CD 1", "cd1", "Disc 2",
/// "FLAC 24-96"), whose own folder is the one with the record's name. A bare number counts only as a bitrate
/// ("320"), so an album called "1999" or "4" stays itself.
fn is_format_or_disc_word(name: &str) -> bool {
    let lower = name.trim().to_ascii_lowercase();
    if ["128", "160", "192", "224", "256", "320"].contains(&lower.as_str()) {
        return true;
    }
    let tokens: Vec<&str> = lower.split(|c: char| !c.is_ascii_alphanumeric()).filter(|t| !t.is_empty()).collect();
    let filler = |t: &str| t == "of" || t.bytes().all(|b| b.is_ascii_digit());
    tokens.iter().any(|t| format_token(t)) && tokens.iter().all(|t| format_token(t) || filler(t))
}

/// A folder that is a place on the computer rather than a record: the home folder, Desktop, Downloads, Documents,
/// Music, iCloud Drive, or the top of a disk.
fn is_generic_place(dir: &Path, home: Option<&Path>) -> bool {
    let Some(name) = dir.file_name() else { return true };
    home.is_some_and(|h| dir == h)
        || GENERIC_PLACES.contains(&name.to_string_lossy().to_lowercase().as_str())
        || dir.parent() == Some(Path::new("/Volumes"))
}

/// The folder in the music folder that loose files from `parent` go into (it only reads the path): the folder
/// they came from, by name; past one named only for a format or disc ("MP3", "CD 1") to the one above it; and
/// "Added music" when that is a place rather than a record (Downloads, the Desktop, the home folder).
fn folder_for_loose(parent: &Path, home: Option<&Path>) -> String {
    let mut dir = parent;
    while dir.file_name().is_some_and(|n| is_format_or_disc_word(&n.to_string_lossy())) {
        match dir.parent() {
            Some(up) => dir = up,
            None => break,
        }
    }
    match dir.file_name() {
        Some(name) if !is_generic_place(dir, home) && !is_format_or_disc_word(&name.to_string_lossy()) => {
            name.to_string_lossy().into_owned()
        }
        _ => ADDED_MUSIC.into(),
    }
}

/// The person's home folder as the system spells it once links are followed, so it compares with a picked path.
fn home_dir() -> Option<PathBuf> {
    let var = if cfg!(windows) {
        std::env::var_os("USERPROFILE").or_else(|| std::env::var_os("HOME"))
    } else {
        std::env::var_os("HOME")
    };
    var.and_then(|h| fs::canonicalize(h).ok())
}

/// `dest` with " <n>" before its extension: "01 Intro.mp3" -> "01 Intro 2.mp3".
fn numbered(dest: &Path, n: u32) -> PathBuf {
    let mut name: OsString = dest.file_stem().map(OsString::from).unwrap_or_default();
    name.push(format!(" {n}"));
    if let Some(ext) = dest.extension() {
        name.push(".");
        name.push(ext);
    }
    dest.with_file_name(name)
}

/// Fill `buf` from `f` as far as the file goes; how much it filled.
fn read_full(f: &mut impl Read, buf: &mut [u8]) -> std::io::Result<usize> {
    let mut filled = 0;
    while filled < buf.len() {
        match f.read(&mut buf[filled..]) {
            Ok(0) => break,
            Ok(k) => filled += k,
            Err(e) if e.kind() == std::io::ErrorKind::Interrupted => {}
            Err(e) => return Err(e),
        }
    }
    Ok(filled)
}

/// The two files hold exactly the same bytes.
fn same_bytes(a: &Path, b: &Path) -> std::io::Result<bool> {
    let (mut x, mut y) = (fs::File::open(a)?, fs::File::open(b)?);
    let (mut bx, mut by) = (vec![0u8; 1 << 16], vec![0u8; 1 << 16]);
    loop {
        let (n, m) = (read_full(&mut x, &mut bx)?, read_full(&mut y, &mut by)?);
        if n != m || bx[..n] != by[..m] {
            return Ok(false);
        }
        if n == 0 {
            return Ok(true);
        }
    }
}

/// Where a song goes when it's added.
#[derive(Debug, PartialEq)]
enum Place {
    /// Nothing there: write it at this path.
    Free(PathBuf),
    /// The very same file (same size, same bytes) is already there: nothing to do.
    Same,
}

/// Where the song `src` (`size` bytes) lands when it is meant for `dest`: there, if nothing is; nowhere, if the very
/// same file already is; and beside it as "<name> 2", "<name> 3" and on (the first number that is free, or that
/// holds the very same file) when a different song already has the name.
fn place(dest: &Path, src: &Path, size: u64) -> std::io::Result<Place> {
    for n in 1..=9999u32 {
        let at = if n == 1 { dest.to_path_buf() } else { numbered(dest, n) };
        match fs::symlink_metadata(&at) {
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(Place::Free(at)),
            Err(e) => return Err(e),
            Ok(m) if m.is_file() && m.len() == size && same_bytes(src, &at)? => return Ok(Place::Same),
            Ok(_) => {}
        }
    }
    Err(std::io::Error::other("too many songs of that name are already there"))
}

/// What to do with `paths`, checked before a single file moves. Err when the whole add should stop.
/// Every song is filed by its tags (`file_by_tags`). One whose tags don't name its album lands as it always did:
/// in a folder's own name, or for loose files (gathered by the folder they came from) in `folder_for_loose` of it.
/// `home` is the person's home folder (`home_dir`).
fn plan(music: &Path, paths: &[String], home: Option<&Path>, read: &[PathBuf]) -> Result<(Vec<Item>, u32), String> {
    let mut items: Vec<Item> = Vec::new();
    // Each loose file's source folder, and where in `items` its files are gathered.
    let mut loose: HashMap<PathBuf, usize> = HashMap::new();
    let mut already = 0u32;
    for raw in paths {
        let src = PathBuf::from(raw);
        let meta = fs::symlink_metadata(&src).map_err(|e| format!("{raw}: {e}"))?;
        if meta.file_type().is_symlink() || hidden(&src) {
            continue;
        }
        let real = fs::canonicalize(&src).map_err(|e| format!("{raw}: {e}"))?;
        // Handing over a folder that holds the music folder (Music, the home folder) would move it into itself.
        if music.starts_with(&real) {
            return Err(format!(
                "{} holds Cassette's own music folder. Add the albums inside it instead.",
                real.display()
            ));
        }
        let Some(name) = real.file_name().map(PathBuf::from) else {
            continue;
        };
        // In a folder Cassette reads where it is (board #1163): it's already in the library, and a move
        // would take it out of the folder the person asked Cassette to leave alone.
        if let Some(folder) = read.iter().find(|f| real.starts_with(f)) {
            return Err(format!(
                "Cassette already plays this from {}, where it is. There's nothing to add.",
                folder.display()
            ));
        }
        // Already in the music folder: nothing to do.
        if real.starts_with(music) {
            already += 1;
            continue;
        }
        if meta.is_dir() {
            let mut files = Vec::new();
            walk(&real, &name, &mut files).map_err(|e| format!("{raw}: {e}"))?;
            // In order of where they are, so when two discs share a file name it is the first disc's that keeps it.
            files.sort_by(|a, b| a.0.cmp(&b.0));
            items.push(Item { src: real, files, is_dir: true });
        } else if meta.is_file() {
            let Some(parent) = real.parent() else { continue };
            let folder = folder_for_loose(parent, home);
            let at = *loose.entry(parent.to_path_buf()).or_insert_with(|| {
                items.push(Item { src: parent.to_path_buf(), files: Vec::new(), is_dir: false });
                items.len() - 1
            });
            items[at].files.push((real.clone(), Path::new(&folder).join(&name), meta.len()));
        }
    }
    for it in &mut items {
        it.files = file_by_tags(&it.src, std::mem::take(&mut it.files), &read_tags);
    }
    items.retain(|it| it.files.iter().any(|(s, _, _)| is_audio(s)));
    if items.is_empty() && already == 0 {
        return Err("There's no music in what you added. Cassette takes music files (FLAC, MP3, AAC and the like) and folders of them.".into());
    }
    Ok((items, already))
}

/// Copy `src` beside `dest` under a temporary name, flush it to disk, check its size, then give it its name.
fn copy_safely(src: &Path, dest: &Path, size: u64) -> std::io::Result<()> {
    let name = dest.file_name().and_then(|n| n.to_str()).unwrap_or("music");
    let tmp = dest.with_file_name(format!(".{name}.cassette-adding"));
    // The system's own copy: it brings the Finder tags, comments and dates along.
    fs::copy(src, &tmp)?;
    let written = fs::File::open(&tmp).and_then(|f| f.sync_all().and_then(|_| f.metadata()));
    match written {
        Ok(m) if m.len() == size => fs::rename(&tmp, dest),
        Ok(_) => {
            let _ = fs::remove_file(&tmp);
            Err(std::io::Error::other("the copy came out a different size"))
        }
        Err(e) => {
            let _ = fs::remove_file(&tmp);
            Err(e)
        }
    }
}

/// After a folder's files have moved out one by one: take away the folders left empty, Finder's and Windows'
/// own bookkeeping aside (.DS_Store, Thumbs.db, desktop.ini), deepest first. Anything else still inside keeps its
/// folder.
fn tidy_emptied(dir: &Path) {
    let Ok(entries) = fs::read_dir(dir) else { return };
    for entry in entries.flatten() {
        let p = entry.path();
        if fs::symlink_metadata(&p).is_ok_and(|m| m.is_dir()) {
            tidy_emptied(&p);
        }
    }
    let left: Vec<PathBuf> = match fs::read_dir(dir) {
        Ok(e) => e.flatten().map(|e| e.path()).collect(),
        Err(_) => return,
    };
    if left.iter().all(|p| p.file_name().is_some_and(crate::win::system_file)) {
        for p in &left {
            let _ = fs::remove_file(p);
        }
        let _ = fs::remove_dir(dir);
    }
}

/// Add `paths` to `music`, moving or copying. `progress` hears how far it has got: once when the songs are counted,
/// then after every song.
fn add(
    music: &Path,
    paths: &[String],
    moving: bool,
    progress: &mut dyn FnMut(AddProgress),
) -> Result<AddReport, String> {
    add_beside_read(music, paths, moving, &[], progress)
}

/// `add`, knowing the folders Cassette reads where they are (board #1163): nothing in one is ever added, so a
/// move can never take music out of it.
fn add_beside_read(
    music: &Path,
    paths: &[String],
    moving: bool,
    read: &[PathBuf],
    progress: &mut dyn FnMut(AddProgress),
) -> Result<AddReport, String> {
    fs::create_dir_all(music).map_err(|e| format!("couldn't make the music folder: {e}"))?;
    let music = fs::canonicalize(music).map_err(|e| e.to_string())?;
    let home = home_dir();
    let read: Vec<PathBuf> = read.iter().filter_map(|p| fs::canonicalize(p).ok()).collect();
    let (items, already) = plan(&music, paths, home.as_deref(), &read)?;
    let mut report = AddReport { already, ..Default::default() };

    // Room first: everything that will be written anew (all of a copy, the other-disk part of a move). A song
    // whose name is taken by one of a different size goes in beside it, so it counts too.
    let need: u64 = items
        .iter()
        .filter(|it| !(moving && same_disk(&it.src, &music)))
        .flat_map(|it| it.files.iter())
        .filter(|(src, rel, size)| match fs::metadata(music.join(rel)) {
            Err(_) => true,
            Ok(m) => is_audio(src) && m.len() != *size,
        })
        .map(|(_, _, size)| size)
        .sum();
    if need > 0 {
        if let Some(free) = free_bytes(&music) {
            if need + SPARE_BYTES > free {
                return Err(format!(
                    "There isn't room on this computer: this needs {} and {} is free.",
                    gb(need),
                    gb(free)
                ));
            }
        }
    }

    let total = items.iter().flat_map(|it| it.files.iter()).filter(|(s, _, _)| is_audio(s)).count() as u32;
    let mut done = 0u32;
    progress(report.progress(done, total));

    for it in &items {
        // A move on the same disk renames each file into its album's folder, which is instant; the folders it
        // leaves empty are tidied away after.
        let local = moving && same_disk(&it.src, &music);
        for (src, rel, size) in &it.files {
            let counts = is_audio(src);
            let meant = music.join(rel);
            // A song goes in beside a different one of the same name. Anything else already there (a cover, a
            // note) is left as it is, and this one stays where it was.
            let dest = if counts {
                match place(&meant, src, *size) {
                    Ok(Place::Same) => {
                        report.already += 1;
                        done += 1;
                        progress(report.progress(done, total));
                        continue;
                    }
                    Ok(Place::Free(at)) => Ok(at),
                    Err(e) => Err(e),
                }
            } else if fs::symlink_metadata(&meant).is_ok() {
                continue;
            } else {
                Ok(meant)
            };
            let result = dest.and_then(|dest| {
                dest.parent()
                    .map_or(Ok(()), fs::create_dir_all)
                    .and_then(|_| if local { fs::rename(src, &dest) } else { copy_safely(src, &dest, *size) })
                    .and_then(|_| if moving && !local { fs::remove_file(src) } else { Ok(()) })
            });
            match result {
                Ok(()) if counts => report.added += 1,
                Ok(()) => {}
                Err(e) => {
                    report.failed += 1;
                    report.error.get_or_insert(format!("{}: {e}", src.display()));
                }
            }
            if counts {
                done += 1;
                progress(report.progress(done, total));
            }
        }
        if moving && it.is_dir {
            tidy_emptied(&it.src);
        }
    }
    Ok(report)
}

/// Move or copy `paths` (files and folders the person dropped on the window or picked) into the music folder.
/// `mode` is "move" or "copy", the person's own answer. The window hears `PROGRESS_EVENT` after every song.
/// `dest` is the Cassette folder as the hub reports it (it can be moved, board #1163); `read` the folders
/// Cassette reads where they are, which nothing is ever moved out of. A page older than this app sends
/// neither, and then it adds where it always did.
#[tauri::command]
pub async fn add_music(
    app: tauri::AppHandle,
    paths: Vec<String>,
    mode: String,
    dest: Option<String>,
    read: Option<Vec<String>>,
) -> Result<AddReport, String> {
    let moving = match mode.as_str() {
        "move" => true,
        "copy" => false,
        _ => return Err(format!("unknown mode {mode}")),
    };
    let from_hub = dest.filter(|d| Path::new(d).is_absolute()).map(PathBuf::from);
    // The hub makes its Cassette folder whenever its place exists, so one it names that isn't there is on a
    // drive that's away: making it would start a new library on this computer's own disk.
    if let Some(d) = &from_hub {
        if away(d) {
            return Err("The Cassette folder's drive isn't connected. Connect it and try again.".into());
        }
    }
    // A dev build runs no hub of its own; it adds to the folder a hand-run hub watches by default.
    let music = match (from_hub, MUSIC_DIR.get()) {
        (Some(d), _) => d,
        (None, Some(dir)) => dir.clone(),
        (None, None) => PathBuf::from(std::env::var("HOME").map_err(|_| "no home folder")?).join("Music/Cassette"),
    };
    let read: Vec<PathBuf> = read.unwrap_or_default().into_iter().map(PathBuf::from).collect();
    tauri::async_runtime::spawn_blocking(move || {
        add_beside_read(&music, &paths, moving, &read, &mut |p: AddProgress| {
            let _ = app.emit(PROGRESS_EVENT, p);
        })
    })
        .await
        .map_err(|e| e.to_string())?
}

/// A folder that isn't there and whose place isn't either: its drive is unplugged.
fn away(music: &Path) -> bool {
    !music.exists() && !music.parent().is_some_and(|p| p.is_dir())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn nothing_moves_out_of_a_folder_cassette_reads() {
        let root = scratch("read");
        let music = root.join("Music/Cassette");
        let read = root.join("NAS/Music");
        let album = read.join("Artist/Album");
        put(&album.join("01.flac"), b"one");
        let err = add_beside_read(&music, &[s(&album)], true, &[read.clone()], &mut |_: AddProgress| {}).unwrap_err();
        assert!(err.contains("already plays"), "{err}");
        assert!(album.join("01.flac").exists(), "the song stays where it is");
        fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn a_drive_thats_unplugged_is_away() {
        let root = scratch("away");
        fs::create_dir_all(root.join("Music")).unwrap();
        assert!(away(&root.join("Volumes/Drive/Cassette")));
        assert!(!away(&root.join("Music/Cassette")), "a fresh Cassette folder in Music is made, not away");
        fs::remove_dir_all(&root).unwrap();
    }

    fn scratch(name: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("cassette-add-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&d);
        fs::create_dir_all(&d).unwrap();
        d
    }

    fn put(p: &Path, bytes: &[u8]) {
        fs::create_dir_all(p.parent().unwrap()).unwrap();
        fs::write(p, bytes).unwrap();
    }

    fn s(p: &Path) -> String {
        p.to_string_lossy().into_owned()
    }

    fn run(music: &Path, paths: &[String], moving: bool) -> Result<AddReport, String> {
        add(music, paths, moving, &mut |_: AddProgress| {})
    }

    #[test]
    fn loose_files_take_the_name_of_the_folder_they_came_from() {
        let home = Path::new("/Users/me/"); // the trailing slash keeps the export check quiet; paths compare by part
        let named = |p: &str| folder_for_loose(Path::new(p), Some(home));
        // an ordinary folder: its own name
        assert_eq!(named("/Users/me/Downloads/Abbey Road"), "Abbey Road");
        assert_eq!(named("/Volumes/USB/Prince/1999"), "1999");
        assert_eq!(named("/Users/me/Music/iTunes/Beyonce/4"), "4");
        // a folder named only for a format or a disc: the one above it
        assert_eq!(named("/Users/me/Downloads/Abbey Road/MP3"), "Abbey Road");
        assert_eq!(named("/Users/me/Downloads/Abbey Road/flac"), "Abbey Road");
        assert_eq!(named("/Users/me/Downloads/Abbey Road/320"), "Abbey Road");
        assert_eq!(named("/Users/me/Downloads/Abbey Road/V0"), "Abbey Road");
        assert_eq!(named("/Users/me/Downloads/Abbey Road/CD 1"), "Abbey Road");
        assert_eq!(named("/Users/me/Downloads/Abbey Road/cd1"), "Abbey Road");
        assert_eq!(named("/Users/me/Downloads/Abbey Road/Disc 2"), "Abbey Road");
        assert_eq!(named("/Users/me/Downloads/Abbey Road/Disk 1"), "Abbey Road");
        assert_eq!(named("/Users/me/Downloads/Abbey Road/MP3 320"), "Abbey Road");
        assert_eq!(named("/Users/me/Downloads/Abbey Road/FLAC 24-96"), "Abbey Road");
        assert_eq!(named("/Users/me/Downloads/Abbey Road/FLAC/Disc 1"), "Abbey Road");
        // a place on the computer, not a record
        for generic in [
            "/Users/me/",
            "/Users/me/Desktop",
            "/Users/me/Downloads",
            "/Users/me/Documents",
            "/Users/me/Music",
            "/Users/me/Downloads/MP3",
            "/Volumes/USB",
            "/Volumes/USB/FLAC",
            "/",
        ] {
            assert_eq!(named(generic), "Added music", "{generic}");
        }
        assert!(!is_format_or_disc_word("1999") && !is_format_or_disc_word("Disc Jockey Blues"));
    }

    #[test]
    fn a_name_already_taken_goes_beside_it_unless_it_is_the_very_same_file() {
        let root = scratch("clash");
        let src = root.join("in/x.mp3");
        put(&src, b"song");
        let dest = root.join("music/Album/x.mp3");
        // nothing there: its own name
        assert_eq!(place(&dest, &src, 4).unwrap(), Place::Free(dest.clone()));
        // a different song of the same size: beside it
        put(&dest, b"tune");
        assert_eq!(place(&dest, &src, 4).unwrap(), Place::Free(root.join("music/Album/x 2.mp3")));
        // that one taken too, by another different song: the next number
        put(&root.join("music/Album/x 2.mp3"), b"other");
        assert_eq!(place(&dest, &src, 4).unwrap(), Place::Free(root.join("music/Album/x 3.mp3")));
        // the very same file already there, under its own name or a numbered one: nothing to do
        put(&root.join("music/Album/x 3.mp3"), b"song");
        assert_eq!(place(&dest, &src, 4).unwrap(), Place::Same);
        put(&dest, b"song");
        assert_eq!(place(&dest, &src, 4).unwrap(), Place::Same);
        assert_eq!(numbered(Path::new("/m/01 Intro.mp3"), 2), Path::new("/m/01 Intro 2.mp3"));
        assert_eq!(numbered(Path::new("/m/a.b.flac"), 3), Path::new("/m/a.b 3.flac"));
        fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn picked_files_go_into_a_folder_and_the_window_hears_every_song() {
        let root = scratch("loose");
        let music = root.join("Music/Cassette");
        let mp3 = root.join("Downloads/Abbey Road/MP3");
        put(&mp3.join("01 Come Together.mp3"), b"one");
        put(&mp3.join("02 Something.mp3"), b"two");
        put(&root.join("Downloads/single.mp3"), b"single");
        let picked = [s(&mp3.join("01 Come Together.mp3")), s(&mp3.join("02 Something.mp3")), s(&root.join("Downloads/single.mp3"))];
        let mut heard = Vec::new();
        let r = add(&music, &picked, false, &mut |p: AddProgress| heard.push(p)).unwrap();
        assert_eq!((r.added, r.already, r.failed), (3, 0, 0));
        assert_eq!(fs::read(music.join("Abbey Road/01 Come Together.mp3")).unwrap(), b"one");
        assert_eq!(fs::read(music.join("Abbey Road/02 Something.mp3")).unwrap(), b"two");
        assert_eq!(fs::read(music.join("Added music/single.mp3")).unwrap(), b"single");
        assert!(!music.join("01 Come Together.mp3").exists(), "nothing lands loose in the music folder");
        assert!(mp3.join("01 Come Together.mp3").exists(), "a copy leaves the originals");
        assert_eq!(heard.len(), 4, "once when counted, then after every song: {heard:?}");
        assert_eq!(heard[0], AddProgress { total: 3, ..Default::default() });
        assert_eq!(heard[3], AddProgress { done: 3, total: 3, added: 3, already: 0, failed: 0 });

        // the same songs again: already there; a different song under a taken name goes in beside it
        put(&mp3.join("02 Something.mp3"), b"another take");
        let r = add(&music, &picked, true, &mut |_: AddProgress| {}).unwrap();
        assert_eq!((r.added, r.already, r.failed), (1, 2, 0));
        assert_eq!(fs::read(music.join("Abbey Road/02 Something.mp3")).unwrap(), b"two");
        assert_eq!(fs::read(music.join("Abbey Road/02 Something 2.mp3")).unwrap(), b"another take");
        assert!(!mp3.join("02 Something.mp3").exists(), "a move takes the one it added");
        assert!(mp3.join("01 Come Together.mp3").exists(), "and leaves the one already there");
        fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn a_move_takes_the_whole_album_folder_and_leaves_nothing_behind() {
        let root = scratch("move");
        let music = root.join("Music/Cassette");
        let album = root.join("Downloads/Album");
        put(&album.join("01.flac"), b"one");
        put(&album.join("cover.jpg"), b"art");
        let r = run(&music, &[s(&album)], true).unwrap();
        assert_eq!((r.added, r.already, r.failed), (1, 0, 0));
        assert!(music.join("Album/01.flac").exists() && music.join("Album/cover.jpg").exists());
        assert!(!album.exists());
        fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn a_copy_leaves_the_originals_and_never_overwrites() {
        let root = scratch("copy");
        let music = root.join("Music/Cassette");
        let album = root.join("Desktop/Album");
        put(&album.join("01.mp3"), b"new");
        put(&album.join("02.mp3"), b"two");
        put(&album.join("03.mp3"), b"three");
        put(&music.join("Album/01.mp3"), b"mine");
        put(&music.join("Album/02.mp3"), b"two");
        let r = run(&music, &[s(&album)], false).unwrap();
        assert_eq!((r.added, r.already, r.failed), (2, 1, 0));
        assert_eq!(fs::read(music.join("Album/01.mp3")).unwrap(), b"mine");
        assert_eq!(fs::read(music.join("Album/01 2.mp3")).unwrap(), b"new");
        assert_eq!(fs::read(music.join("Album/02.mp3")).unwrap(), b"two");
        assert!(!music.join("Album/02 2.mp3").exists(), "the very same file isn't added twice");
        assert_eq!(fs::read(music.join("Album/03.mp3")).unwrap(), b"three");
        assert!(album.join("01.mp3").exists() && album.join("02.mp3").exists() && album.join("03.mp3").exists());
        fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn the_music_folder_never_moves_into_itself() {
        let root = scratch("self");
        let music = root.join("Music/Cassette");
        put(&music.join("Album/01.flac"), b"one");
        let err = run(&music, &[s(&root.join("Music"))], true).unwrap_err();
        assert!(err.contains("holds Cassette's own music folder"), "{err}");
        let r = run(&music, &[s(&music.join("Album"))], true).unwrap();
        assert_eq!((r.added, r.already), (0, 1));
        assert!(music.join("Album/01.flac").exists());
        fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn something_with_no_music_in_it_is_refused() {
        let root = scratch("nomusic");
        let music = root.join("Music/Cassette");
        let docs = root.join("Docs");
        put(&docs.join("notes.txt"), b"x");
        assert!(run(&music, &[s(&docs)], true).unwrap_err().contains("no music"));
        assert!(docs.join("notes.txt").exists());
        fs::remove_dir_all(&root).unwrap();
    }

    fn tags(album_artist: Option<&str>, artist: Option<&str>, album: Option<&str>) -> SongTags {
        let own = |s: Option<&str>| s.map(String::from);
        SongTags { album_artist: own(album_artist), artist: own(artist), album: own(album) }
    }

    /// A FLAC file with no sound in it and these Vorbis comments ("ALBUM", "The Album").
    fn flac(comments: &[(&str, &str)]) -> Vec<u8> {
        let mut b = b"fLaC".to_vec();
        // STREAMINFO: 4096-sample blocks, 44.1 kHz, two channels, 16 bits, no frames.
        b.extend([0x00, 0x00, 0x00, 34]);
        b.extend(4096u16.to_be_bytes());
        b.extend(4096u16.to_be_bytes());
        b.extend([0u8; 6]);
        b.extend(((44100u64 << 44) | (1 << 41) | (15 << 36)).to_be_bytes());
        b.extend([0u8; 16]);
        let mut body = Vec::new();
        body.extend(4u32.to_le_bytes());
        body.extend(b"test");
        body.extend((comments.len() as u32).to_le_bytes());
        for (key, value) in comments {
            let c = format!("{key}={value}");
            body.extend((c.len() as u32).to_le_bytes());
            body.extend(c.as_bytes());
        }
        b.push(0x80 | 4); // the last block: VORBIS_COMMENT
        b.extend(&(body.len() as u32).to_be_bytes()[1..]);
        b.extend(body);
        b
    }

    /// An MP3 with an ID3v2.3 tag of these frames ("TALB", "The Album") and three silent frames.
    fn mp3(frames: &[(&str, &str)]) -> Vec<u8> {
        let mut body = Vec::new();
        for (id, text) in frames {
            body.extend(id.as_bytes());
            body.extend(((text.len() + 1) as u32).to_be_bytes());
            body.extend([0, 0, 0]); // no flags; ISO-8859-1 text
            body.extend(text.as_bytes());
        }
        let n = body.len() as u32;
        let mut b = b"ID3\x03\x00\x00".to_vec();
        b.extend([(n >> 21) as u8 & 0x7f, (n >> 14) as u8 & 0x7f, (n >> 7) as u8 & 0x7f, n as u8 & 0x7f]);
        b.extend(body);
        for _ in 0..3 {
            b.extend([0xFF, 0xFB, 0x90, 0x00]); // MPEG-1 layer III, 128 kbps, 44.1 kHz: 417 bytes a frame
            b.extend([0u8; 413]);
        }
        b
    }

    #[test]
    fn a_song_is_filed_under_its_album_artist_and_album() {
        let at = |t: SongTags| tag_folder(&t).map(|p| p.to_string_lossy().into_owned());
        let folder = |artist: &str, album: &str| Some(Path::new(artist).join(album).to_string_lossy().into_owned());
        // the album artist over the song's own artist, so a record's guests don't scatter it
        let various = tags(Some("Various Artists"), Some("Beck"), Some("Big Hits"));
        assert_eq!(at(various), folder("Various Artists", "Big Hits"));
        // no album artist: the song's artist
        assert_eq!(at(tags(None, Some("Beck"), Some("Odelay"))), folder("Beck", "Odelay"));
        assert_eq!(at(tags(Some("  "), Some("Beck"), Some("Odelay"))), folder("Beck", "Odelay"));
        assert_eq!(at(tags(Some("?"), Some("Beck"), Some("Odelay"))), folder("Beck", "Odelay"));
        // an album and no artist, or an artist and an album with nothing a folder can be called: as rips do
        assert_eq!(at(tags(None, None, Some("Odelay"))), folder("Unknown Artist", "Odelay"));
        assert_eq!(at(tags(None, Some("Beck"), Some("???"))), folder("Beck", "Unknown Album"));
        // no album, or nothing usable in either: no folder from the tags, so the song lands by its own folder
        assert_eq!(at(tags(Some("Beck"), Some("Beck"), None)), None);
        assert_eq!(at(tags(None, Some("Beck"), Some(" "))), None);
        assert_eq!(at(tags(None, None, Some("..."))), None);
        assert_eq!(at(SongTags::default()), None);
    }

    #[test]
    fn folder_names_are_safe_on_a_mac_and_on_windows() {
        let mac = |s: &str| folder_name_for(s, false);
        let win = |s: &str| folder_name_for(s, true);
        // rip.go's own swaps
        assert_eq!(mac("AC/DC"), "AC-DC");
        assert_eq!(mac("Live: Back\\Forth"), "Live- Back-Forth");
        assert_eq!(mac("Who? *Me* |Now|"), "Who -Me- -Now-");
        assert_eq!(mac("Say \"Hi\" <Live>"), "Say 'Hi' (Live)");
        // control characters out, and no dot or space at either end
        assert_eq!(mac("Tab\there\u{7}"), "Tabhere");
        assert_eq!(mac("  Hello...  "), "Hello");
        assert_eq!(mac("...And Justice for All."), "And Justice for All");
        assert_eq!(mac("Sgt. Pepper"), "Sgt. Pepper");
        assert_eq!(mac(" ?? "), "");
        // a name Windows keeps for a device gets "_", with or without an extension, in any case; on a Mac it stays
        assert_eq!(win("CON"), "CON_");
        assert_eq!(win("con"), "con_");
        assert_eq!(win("Nul.Live"), "Nul_.Live");
        assert_eq!(win("Aux .Live"), "Aux_.Live");
        assert_eq!(win("COM1"), "COM1_");
        assert_eq!(win("lpt9"), "lpt9_");
        assert_eq!(win("PRN"), "PRN_");
        assert_eq!(win("Console"), "Console");
        assert_eq!(win("COM10"), "COM10");
        assert_eq!(win("Connie"), "Connie");
        assert_eq!(mac("CON"), "CON");
        // long names: cut to 120 characters on a character's edge, never mid-letter, and never past 240 bytes
        assert_eq!(mac(&"a".repeat(300)), "a".repeat(120));
        assert_eq!(mac(&"é".repeat(300)), "é".repeat(120));
        assert_eq!(mac(&"😀".repeat(100)), "😀".repeat(60));
        assert_eq!(mac(&format!("{}. and more", "x".repeat(119))), "x".repeat(119), "no dot left at the cut");
    }

    #[test]
    fn covers_follow_the_songs_they_sat_beside_and_two_discs_share_a_folder() {
        let d = Path::new("/In/Abbey Road (Deluxe)");
        let file = |rel: &str| (d.join(rel), Path::new("Abbey Road (Deluxe)").join(rel), 1u64);
        let beatles = tags(Some("The Beatles"), Some("The Beatles"), Some("Abbey Road"));
        let read = |p: &Path| -> SongTags {
            let name = p.file_name().unwrap().to_string_lossy();
            if name.starts_with("untagged") {
                SongTags::default()
            } else if name.starts_with("bonus") {
                tags(None, Some("Paul McCartney"), Some("McCartney"))
            } else {
                beatles.clone()
            }
        };
        let files = vec![
            file("CD1/1-01 Come Together.flac"),
            file("CD1/1-02 Something.flac"),
            file("CD1/bonus.flac"),
            file("CD1/cover.jpg"),
            file("CD2/1-01 Come Together.flac"),
            file("CD2/booklet.pdf"),
            file("Scans/front.jpg"),
            file("Scans/Inlay/back.jpg"),
            file("folder.jpg"),
            file("Untagged/untagged 1.mp3"),
            file("Untagged/untagged.cue"),
            file("Untagged/Scans/inlay.jpg"),
        ];
        let filed: HashMap<PathBuf, PathBuf> =
            file_by_tags(d, files, &read).into_iter().map(|(src, dest, _)| (src, dest)).collect();
        let to = |rel: &str| filed.get(&d.join(rel)).map(|p| p.to_string_lossy().into_owned());
        let at = |p: &str| Some(p.to_string());
        // both discs in one folder, each song under its own file name
        assert_eq!(to("CD1/1-01 Come Together.flac"), at("The Beatles/Abbey Road/1-01 Come Together.flac"));
        assert_eq!(to("CD2/1-01 Come Together.flac"), at("The Beatles/Abbey Road/1-01 Come Together.flac"));
        assert_eq!(to("CD1/bonus.flac"), at("Paul McCartney/McCartney/bonus.flac"));
        // a cover goes where most of its folder's songs went
        assert_eq!(to("CD1/cover.jpg"), at("The Beatles/Abbey Road/cover.jpg"));
        assert_eq!(to("CD2/booklet.pdf"), at("The Beatles/Abbey Road/booklet.pdf"));
        // a folder with no songs of its own follows the songs under the nearest folder above it that has some,
        // its path below that folder kept: the cover on top of CD1/ and CD2/, and a scans folder stays a folder
        assert_eq!(to("folder.jpg"), at("The Beatles/Abbey Road/folder.jpg"));
        assert_eq!(to("Scans/front.jpg"), at("The Beatles/Abbey Road/Scans/front.jpg"));
        assert_eq!(to("Scans/Inlay/back.jpg"), at("The Beatles/Abbey Road/Scans/Inlay/back.jpg"));
        // untagged songs land as they always did, their folder's tree kept, and their .cue and scans with them
        assert_eq!(to("Untagged/untagged 1.mp3"), at("Abbey Road (Deluxe)/Untagged/untagged 1.mp3"));
        assert_eq!(to("Untagged/untagged.cue"), at("Abbey Road (Deluxe)/Untagged/untagged.cue"));
        assert_eq!(to("Untagged/Scans/inlay.jpg"), at("Abbey Road (Deluxe)/Untagged/Scans/inlay.jpg"));
        assert_eq!(filed.len(), 12);
    }

    #[test]
    fn untagged_discs_keep_their_tree_and_a_folder_with_no_songs_sends_nothing() {
        let d = Path::new("/In/Mixtape");
        let file = |rel: &str| (d.join(rel), Path::new("Mixtape").join(rel), 1u64);
        let none = |_: &Path| SongTags::default();
        let files: Vec<_> =
            ["CD1/a.mp3", "CD2/b.mp3", "CD2/c.mp3", "cover.jpg", "Scans/back.jpg"].into_iter().map(file).collect();
        let filed: Vec<(PathBuf, PathBuf)> =
            file_by_tags(d, files.clone(), &none).into_iter().map(|(src, dest, _)| (src, dest)).collect();
        // every file exactly where the folder's own tree puts it, as before tags were read
        let before: Vec<(PathBuf, PathBuf)> = files.into_iter().map(|(src, old, _)| (src, old)).collect();
        assert_eq!(filed.len(), before.len());
        for pair in &before {
            assert!(filed.contains(pair), "{pair:?}");
        }
        // a folder with no songs anywhere in it: nothing goes
        let art = Path::new("/In/Artwork");
        let pics = vec![(art.join("poster.jpg"), PathBuf::from("Artwork/poster.jpg"), 1u64)];
        assert!(file_by_tags(art, pics, &none).is_empty());
    }

    #[test]
    fn real_tagged_files_are_read_and_filed_the_way_a_rip_is() {
        let root = scratch("tagged");
        let music = root.join("Music/Cassette");
        let album = root.join("Downloads/Abbey Road (Deluxe)");
        let beatles = [("ALBUMARTIST", "The Beatles"), ("ARTIST", "The Beatles"), ("ALBUM", "Abbey Road")];
        let song = |title: &str| flac(&[("TITLE", title), beatles[0], beatles[1], beatles[2]]);
        put(&album.join("CD1/1-01 Come Together.flac"), &song("Come Together"));
        put(&album.join("CD1/1-02 Something.flac"), &song("Something"));
        put(&album.join("CD1/cover.jpg"), b"art");
        put(&album.join("CD2/2-01 Come Together (Demo).flac"), &flac(&[beatles[1], beatles[2]]));
        put(&album.join("CD2/booklet.pdf"), b"pdf");
        put(&album.join("Scans/front.jpg"), b"scan");
        put(&album.join("folder.jpg"), b"top");
        put(&album.join("Extras/untagged.mp3"), b"not really an mp3");
        let artwork = root.join("Downloads/Artwork");
        put(&artwork.join("poster.jpg"), b"poster");
        let single = root.join("Downloads/song.mp3");
        put(&single, &mp3(&[("TIT2", "1999"), ("TPE1", "Prince"), ("TALB", "1999")]));
        let acdc = root.join("Downloads/hells bells.mp3");
        put(&acdc, &mp3(&[("TPE1", "Brian Johnson"), ("TPE2", "AC/DC"), ("TALB", "Back In Black")]));

        // what lofty reads, and that a file it can't read is no tags rather than a failure
        assert_eq!(read_tags(&single), tags(None, Some("Prince"), Some("1999")));
        assert_eq!(read_tags(&acdc), tags(Some("AC/DC"), Some("Brian Johnson"), Some("Back In Black")));
        let demo = read_tags(&album.join("CD2/2-01 Come Together (Demo).flac"));
        assert_eq!(demo, tags(None, Some("The Beatles"), Some("Abbey Road")));
        assert_eq!(read_tags(&album.join("Extras/untagged.mp3")), SongTags::default());
        assert_eq!(read_tags(&root.join("nowhere.flac")), SongTags::default());

        let mut heard = Vec::new();
        let picked = [s(&album), s(&single), s(&acdc), s(&artwork)];
        let r = add(&music, &picked, true, &mut |p: AddProgress| heard.push(p)).unwrap();
        assert_eq!((r.added, r.already, r.failed), (6, 0, 0), "{:?}", r.error);
        assert_eq!(heard.first(), Some(&AddProgress { total: 6, ..Default::default() }));
        assert_eq!(heard.last(), Some(&AddProgress { done: 6, total: 6, added: 6, already: 0, failed: 0 }));
        let rec = music.join("The Beatles/Abbey Road");
        let names = ["1-01 Come Together.flac", "1-02 Something.flac", "2-01 Come Together (Demo).flac"];
        for name in names.iter().chain(&["cover.jpg", "booklet.pdf", "folder.jpg", "Scans/front.jpg"]) {
            assert!(rec.join(name).is_file(), "{name}");
        }
        assert!(music.join("Prince/1999/song.mp3").is_file());
        assert!(music.join("AC-DC/Back In Black/hells bells.mp3").is_file());
        assert_eq!(fs::read(music.join("Abbey Road (Deluxe)/Extras/untagged.mp3")).unwrap(), b"not really an mp3");
        assert_eq!(fs::read(rec.join("Scans/front.jpg")).unwrap(), b"scan");
        // the move took every file it placed, the top cover and the scans too, and tidied the emptied folders away
        assert!(!album.exists() && !single.exists());
        // a folder with no songs in it sends nothing, and the move leaves it be
        assert_eq!(fs::read(artwork.join("poster.jpg")).unwrap(), b"poster");
        assert!(!music.join("Artwork").exists() && !music.join("The Beatles/Abbey Road/poster.jpg").exists());
        fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn two_discs_with_the_same_file_names_share_the_album_folder_and_a_copy_leaves_them() {
        let root = scratch("discs");
        let music = root.join("Music/Cassette");
        let album = root.join("Desktop/The Wall");
        let wall = [("ARTIST", "Pink Floyd"), ("ALBUM", "The Wall")];
        put(&album.join("CD 1/01.flac"), &flac(&[("TITLE", "In the Flesh?"), wall[0], wall[1]]));
        put(&album.join("CD 2/01.flac"), &flac(&[("TITLE", "Hey You"), wall[0], wall[1]]));
        let r = run(&music, &[s(&album)], false).unwrap();
        assert_eq!((r.added, r.already, r.failed), (2, 0, 0));
        let rec = music.join("Pink Floyd/The Wall");
        assert_eq!(fs::read(rec.join("01.flac")).unwrap(), fs::read(album.join("CD 1/01.flac")).unwrap());
        assert_eq!(fs::read(rec.join("01 2.flac")).unwrap(), fs::read(album.join("CD 2/01.flac")).unwrap());
        // the same again: both already there
        let r = run(&music, &[s(&album)], false).unwrap();
        assert_eq!((r.added, r.already, r.failed), (0, 2, 0));
        assert!(!rec.join("01 3.flac").exists());
        fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn a_folder_merging_into_one_already_there_moves_file_by_file() {
        let root = scratch("merge");
        let music = root.join("Music/Cassette");
        let album = root.join("Downloads/Album");
        put(&album.join("02.flac"), b"two");
        put(&album.join(".DS_Store"), b"finder");
        put(&music.join("Album/01.flac"), b"one");
        let r = run(&music, &[s(&album)], true).unwrap();
        assert_eq!((r.added, r.failed), (1, 0));
        assert!(music.join("Album/01.flac").exists() && music.join("Album/02.flac").exists());
        assert!(!album.exists(), "the emptied folder goes, Finder's own file with it");
        fs::remove_dir_all(&root).unwrap();
    }
}

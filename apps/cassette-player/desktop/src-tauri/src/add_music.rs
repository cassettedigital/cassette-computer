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
//! Where things land: a folder keeps its own name. Loose files (picked one by one, or dropped without their
//! folder) never land loose in the top of the music folder: they go into a folder named for the one they came from
//! (`folder_for_loose`). A song whose name is already taken is either the very same file, left as it is, or a
//! different song, which goes in beside it as "<name> 2" (`place`), so nobody's song is ever skipped unseen.
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
    dest: PathBuf,
    files: Vec<(PathBuf, PathBuf, u64)>,
    is_dir: bool,
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
/// A folder keeps its name. Loose files are gathered by the folder they came from, and each gathering goes into
/// `folder_for_loose` of it. `home` is the person's home folder (`home_dir`).
fn plan(music: &Path, paths: &[String], home: Option<&Path>) -> Result<(Vec<Item>, u32), String> {
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
        // Already in the music folder: nothing to do.
        if real.starts_with(music) {
            already += 1;
            continue;
        }
        if meta.is_dir() {
            let mut files = Vec::new();
            walk(&real, &name, &mut files).map_err(|e| format!("{raw}: {e}"))?;
            items.push(Item { dest: music.join(&name), src: real, files, is_dir: true });
        } else if meta.is_file() {
            let Some(parent) = real.parent() else { continue };
            let folder = folder_for_loose(parent, home);
            let at = *loose.entry(parent.to_path_buf()).or_insert_with(|| {
                let dest = music.join(&folder);
                items.push(Item { dest, src: parent.to_path_buf(), files: Vec::new(), is_dir: false });
                items.len() - 1
            });
            items[at].files.push((real.clone(), Path::new(&folder).join(&name), meta.len()));
        }
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
    fs::create_dir_all(music).map_err(|e| format!("couldn't make the music folder: {e}"))?;
    let music = fs::canonicalize(music).map_err(|e| e.to_string())?;
    let home = home_dir();
    let (items, already) = plan(&music, paths, home.as_deref())?;
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
        let local = moving && same_disk(&it.src, &music);
        // A whole folder moving on the same disk, with nothing of that name in the music folder yet: one rename
        // takes everything in it along, its pictures included, in an instant.
        if local && it.is_dir && !it.dest.exists() {
            let songs = it.files.iter().filter(|(s, _, _)| is_audio(s)).count() as u32;
            match fs::rename(&it.src, &it.dest) {
                Ok(()) => report.added += songs,
                Err(e) => {
                    report.failed += 1;
                    report.error.get_or_insert(format!("{}: {e}", it.src.display()));
                }
            }
            done += songs;
            progress(report.progress(done, total));
            continue;
        }
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
#[tauri::command]
pub async fn add_music(app: tauri::AppHandle, paths: Vec<String>, mode: String) -> Result<AddReport, String> {
    let moving = match mode.as_str() {
        "move" => true,
        "copy" => false,
        _ => return Err(format!("unknown mode {mode}")),
    };
    // A dev build runs no hub of its own; it adds to the folder a hand-run hub watches by default.
    let music = match MUSIC_DIR.get() {
        Some(dir) => dir.clone(),
        None => PathBuf::from(std::env::var("HOME").map_err(|_| "no home folder")?).join("Music/Cassette"),
    };
    tauri::async_runtime::spawn_blocking(move || {
        add(&music, &paths, moving, &mut |p: AddProgress| {
            let _ = app.emit(PROGRESS_EVENT, p);
        })
    })
        .await
        .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;

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

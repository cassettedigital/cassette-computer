//! Adding music from the person's own folders into the hub's music folder (BUG-868; the founder, 2026-11-06:
//! "I honestly prefer when files get moved instead of copied - can we make that something it asks about on first
//! copy?"). The page asks once, Move or Copy, remembers the answer, and calls `add_music` with it. The work is done
//! here because only the app knows where a dropped or picked file lives: a web page gets its bytes, never its path.
//! The hub watches its music folder and takes it from there.
//!
//! The rules: nothing already there is overwritten, the music folder can't be moved into itself, a copy (or a move
//! to another disk) first checks there is room for it, a copy keeps the file's Finder tags and dates (the system's
//! own copy), and a move to another disk removes each original only after its copy is safely written.

use std::fs;
use std::path::{Path, PathBuf};
use std::sync::OnceLock;

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
    /// Already there under the same name; left alone.
    already: u32,
    /// Couldn't be added; `error` says why for the first one.
    failed: u32,
    error: Option<String>,
}

/// One thing the person handed over: a file, or a folder with the files inside it (relative paths).
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

/// What to do with `paths`, checked before a single file moves. Err when the whole add should stop.
fn plan(music: &Path, paths: &[String]) -> Result<(Vec<Item>, u32), String> {
    let mut items = Vec::new();
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
        let mut files = Vec::new();
        if meta.is_dir() {
            walk(&real, &name, &mut files).map_err(|e| format!("{raw}: {e}"))?;
        } else if meta.is_file() {
            files.push((real.clone(), name.clone(), meta.len()));
        }
        if files.iter().any(|(s, _, _)| is_audio(s)) {
            items.push(Item { dest: music.join(&name), src: real, files, is_dir: meta.is_dir() });
        }
    }
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

fn add(music: &Path, paths: &[String], moving: bool) -> Result<AddReport, String> {
    fs::create_dir_all(music).map_err(|e| format!("couldn't make the music folder: {e}"))?;
    let music = fs::canonicalize(music).map_err(|e| e.to_string())?;
    let (items, already) = plan(&music, paths)?;
    let mut report = AddReport { already, ..Default::default() };

    // Room first: everything that will be written anew (all of a copy, the other-disk part of a move).
    let need: u64 = items
        .iter()
        .filter(|it| !(moving && same_disk(&it.src, &music)))
        .flat_map(|it| it.files.iter())
        .filter(|(_, rel, _)| !music.join(rel).exists())
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

    for it in &items {
        let local = moving && same_disk(&it.src, &music);
        // A whole folder moving on the same disk, with nothing of that name in the music folder yet: one rename
        // takes everything in it along, its pictures included, in an instant.
        if local && it.is_dir && !it.dest.exists() {
            match fs::rename(&it.src, &it.dest) {
                Ok(()) => {
                    report.added += it.files.iter().filter(|(s, _, _)| is_audio(s)).count() as u32;
                    continue;
                }
                Err(e) => {
                    report.failed += 1;
                    report.error.get_or_insert(format!("{}: {e}", it.src.display()));
                    continue;
                }
            }
        }
        for (src, rel, size) in &it.files {
            let dest = music.join(rel);
            let counts = is_audio(src);
            if dest.exists() {
                if counts {
                    report.already += 1;
                }
                continue;
            }
            let done = dest
                .parent()
                .map_or(Ok(()), fs::create_dir_all)
                .and_then(|_| if local { fs::rename(src, &dest) } else { copy_safely(src, &dest, *size) })
                .and_then(|_| if moving && !local { fs::remove_file(src) } else { Ok(()) });
            match done {
                Ok(()) if counts => report.added += 1,
                Ok(()) => {}
                Err(e) => {
                    report.failed += 1;
                    report.error.get_or_insert(format!("{}: {e}", src.display()));
                }
            }
        }
        if moving && it.is_dir {
            tidy_emptied(&it.src);
        }
    }
    Ok(report)
}

/// Move or copy `paths` (files and folders the person dropped on the window or picked) into the music folder.
/// `mode` is "move" or "copy", the person's own answer.
#[tauri::command]
pub async fn add_music(paths: Vec<String>, mode: String) -> Result<AddReport, String> {
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
    tauri::async_runtime::spawn_blocking(move || add(&music, &paths, moving))
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

    #[test]
    fn a_move_takes_the_whole_album_folder_and_leaves_nothing_behind() {
        let root = scratch("move");
        let music = root.join("Music/Cassette");
        let album = root.join("Downloads/Album");
        put(&album.join("01.flac"), b"one");
        put(&album.join("cover.jpg"), b"art");
        let r = add(&music, &[s(&album)], true).unwrap();
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
        put(&music.join("Album/01.mp3"), b"mine");
        let r = add(&music, &[s(&album)], false).unwrap();
        assert_eq!((r.added, r.already, r.failed), (1, 1, 0));
        assert_eq!(fs::read(music.join("Album/01.mp3")).unwrap(), b"mine");
        assert_eq!(fs::read(music.join("Album/02.mp3")).unwrap(), b"two");
        assert!(album.join("01.mp3").exists() && album.join("02.mp3").exists());
        fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn the_music_folder_never_moves_into_itself() {
        let root = scratch("self");
        let music = root.join("Music/Cassette");
        put(&music.join("Album/01.flac"), b"one");
        let err = add(&music, &[s(&root.join("Music"))], true).unwrap_err();
        assert!(err.contains("holds Cassette's own music folder"), "{err}");
        let r = add(&music, &[s(&music.join("Album"))], true).unwrap();
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
        assert!(add(&music, &[s(&docs)], true).unwrap_err().contains("no music"));
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
        let r = add(&music, &[s(&album)], true).unwrap();
        assert_eq!((r.added, r.failed), (1, 0));
        assert!(music.join("Album/01.flac").exists() && music.join("Album/02.flac").exists());
        assert!(!album.exists(), "the emptied folder goes, Finder's own file with it");
        fs::remove_dir_all(&root).unwrap();
    }
}

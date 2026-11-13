//! What the shell needs from Windows itself, in one place (the Windows port, 2026-11-07,
//! docs/CASSETTE_WINDOWS_PORT_PLAN_2026-11-07.md). Each function here is the Windows answer to a piece that
//! macOS does with `lsof`, `kill`, `proc_pidpath`, `statvfs` or a device number.
//!
//! The two connection-table readers are plain byte parsers so they are tested on every computer; only the calls
//! into Windows are compiled for Windows alone.

/// The ids of the programs listening on `port` in a raw IPv4 listener table, as Windows'
/// GetExtendedTcpTable(TCP_TABLE_OWNER_PID_LISTENER) fills it: a u32 row count, then rows of six u32 (state,
/// local address, local port, remote address, remote port, owning pid). The port sits in the low two bytes of
/// its field, in network order.
#[cfg_attr(not(target_os = "windows"), allow(dead_code))]
pub fn listeners_v4(buf: &[u8], port: u16) -> Vec<i32> {
    const ROW: usize = 6 * 4;
    listeners(buf, port, ROW, 8, 20)
}

/// The same for the IPv6 table: rows of 56 bytes (local address 16, scope 4, local port 4, remote address 16,
/// scope 4, remote port 4, state 4, owning pid 4).
#[cfg_attr(not(target_os = "windows"), allow(dead_code))]
pub fn listeners_v6(buf: &[u8], port: u16) -> Vec<i32> {
    const ROW: usize = 56;
    listeners(buf, port, ROW, 20, 52)
}

fn listeners(buf: &[u8], port: u16, row: usize, port_at: usize, pid_at: usize) -> Vec<i32> {
    let u32_at = |i: usize| -> Option<u32> { buf.get(i..i + 4).map(|b| u32::from_ne_bytes([b[0], b[1], b[2], b[3]])) };
    let Some(count) = u32_at(0) else { return Vec::new() };
    let mut pids = Vec::new();
    for n in 0..count as usize {
        let start = 4 + n * row;
        let (Some(p), Some(pid)) = (u32_at(start + port_at), u32_at(start + pid_at)) else { break };
        let local = u16::from_be((p & 0xffff) as u16);
        if local == port && pid != 0 && !pids.contains(&(pid as i32)) {
            pids.push(pid as i32);
        }
    }
    pids
}

/// Things a folder of music brings along that are Windows' or Finder's own bookkeeping, never the person's: left
/// behind when a folder moves in, and no reason to keep an emptied folder.
pub fn system_file(name: &std::ffi::OsStr) -> bool {
    let n = name.to_string_lossy();
    n == ".DS_Store" || n.eq_ignore_ascii_case("Thumbs.db") || n.eq_ignore_ascii_case("desktop.ini")
}

#[cfg(target_os = "windows")]
mod sys {
    use std::ffi::c_void;
    use std::os::windows::ffi::OsStrExt;
    use std::os::windows::io::AsRawHandle;
    use std::path::Path;
    use std::process::{Child, Command};
    use std::sync::OnceLock;

    use windows_sys::Win32::Foundation::{CloseHandle, HANDLE};
    use windows_sys::Win32::NetworkManagement::IpHelper::GetExtendedTcpTable;
    use windows_sys::Win32::Storage::FileSystem::{
        GetDiskFreeSpaceExW, GetFileInformationByHandle, BY_HANDLE_FILE_INFORMATION,
    };
    use windows_sys::Win32::System::JobObjects::{
        AssignProcessToJobObject, CreateJobObjectW, JobObjectExtendedLimitInformation, SetInformationJobObject,
        JOBOBJECT_EXTENDED_LIMIT_INFORMATION, JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
    };
    use windows_sys::Win32::System::Threading::{
        OpenProcess, QueryFullProcessImageNameW, TerminateProcess, PROCESS_QUERY_LIMITED_INFORMATION,
        PROCESS_TERMINATE,
    };

    /// CREATE_NO_WINDOW: a console program started from the app opens no console window. Everything it starts
    /// in turn (Navidrome, ffmpeg, the rip tools) shares that hidden console, so none of them flashes one either.
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    /// GetExtendedTcpTable's table of listening sockets with the owning program's id.
    const TCP_TABLE_OWNER_PID_LISTENER: i32 = 3;
    const AF_INET: u32 = 2;
    const AF_INET6: u32 = 23;
    /// Opens a folder as well as a file, so its volume can be read.
    const FILE_FLAG_BACKUP_SEMANTICS: u32 = 0x0200_0000;

    fn wide(p: &Path) -> Vec<u16> {
        p.as_os_str().encode_wide().chain(std::iter::once(0)).collect()
    }

    pub fn no_console(cmd: &mut Command) {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }

    /// The app's job: every program the app starts is put in it, and Windows ends the whole job the moment the
    /// app's own process ends, a crash or a forced quit included. On macOS a crashed app's hub keeps its ports
    /// until the next launch frees them; here nothing is left behind to free.
    fn job() -> Option<HANDLE> {
        static JOB: OnceLock<isize> = OnceLock::new();
        let h = *JOB.get_or_init(|| unsafe {
            // SAFETY: plain Win32 calls on handles this function owns; the limit structure is zeroed and then
            // given the one flag, the way Windows documents it.
            let job = CreateJobObjectW(std::ptr::null(), std::ptr::null());
            if job.is_null() {
                return 0;
            }
            let mut info: JOBOBJECT_EXTENDED_LIMIT_INFORMATION = std::mem::zeroed();
            info.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
            let ok = SetInformationJobObject(
                job,
                JobObjectExtendedLimitInformation,
                &info as *const _ as *const c_void,
                std::mem::size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32,
            );
            if ok == 0 {
                CloseHandle(job);
                return 0;
            }
            // Never closed: the handle lives as long as the app, and closing it is what ends the job.
            job as isize
        });
        (h != 0).then_some(h as HANDLE)
    }

    pub fn end_with_app(child: &Child) {
        if let Some(job) = job() {
            // SAFETY: the child's handle is valid while `child` lives; a failure only means the child outlives
            // a crash, as on macOS.
            unsafe {
                AssignProcessToJobObject(job, child.as_raw_handle() as HANDLE);
            }
        }
    }

    fn table(family: u32) -> Vec<u8> {
        let mut size: u32 = 0;
        // SAFETY: the first call only asks for the size; the second fills a buffer of exactly that size (asked
        // again if the table grew in between).
        unsafe {
            GetExtendedTcpTable(std::ptr::null_mut(), &mut size, 0, family, TCP_TABLE_OWNER_PID_LISTENER, 0);
            for _ in 0..3 {
                let mut buf = vec![0u8; size as usize + 1024];
                let mut len = buf.len() as u32;
                let rc = GetExtendedTcpTable(
                    buf.as_mut_ptr().cast(),
                    &mut len,
                    0,
                    family,
                    TCP_TABLE_OWNER_PID_LISTENER,
                    0,
                );
                if rc == 0 {
                    buf.truncate(len as usize);
                    return buf;
                }
                size = len;
            }
        }
        Vec::new()
    }

    pub fn listening_pids(port: u16) -> Vec<i32> {
        let mut pids = super::listeners_v4(&table(AF_INET), port);
        for pid in super::listeners_v6(&table(AF_INET6), port) {
            if !pids.contains(&pid) {
                pids.push(pid);
            }
        }
        pids
    }

    pub fn program_of(pid: i32) -> Option<String> {
        // SAFETY: the handle is checked, read once into a buffer of the length given, and closed.
        unsafe {
            let h = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid as u32);
            if h.is_null() {
                return None;
            }
            let mut buf = vec![0u16; 32_768];
            let mut len = buf.len() as u32;
            let ok = QueryFullProcessImageNameW(h, 0, buf.as_mut_ptr(), &mut len);
            CloseHandle(h);
            (ok != 0).then(|| String::from_utf16_lossy(&buf[..len as usize]))
        }
    }

    pub fn stop_pid(pid: i32) {
        // SAFETY: as program_of.
        unsafe {
            let h = OpenProcess(PROCESS_TERMINATE, 0, pid as u32);
            if !h.is_null() {
                TerminateProcess(h, 1);
                CloseHandle(h);
            }
        }
    }

    fn volume_of(p: &Path) -> Option<u32> {
        use std::os::windows::fs::OpenOptionsExt;
        let f = std::fs::OpenOptions::new()
            .read(true)
            .custom_flags(FILE_FLAG_BACKUP_SEMANTICS)
            .open(p)
            .ok()?;
        // SAFETY: the file handle is open for the length of the call; the structure is written by Windows.
        unsafe {
            let mut info: BY_HANDLE_FILE_INFORMATION = std::mem::zeroed();
            (GetFileInformationByHandle(f.as_raw_handle() as HANDLE, &mut info) != 0)
                .then_some(info.dwVolumeSerialNumber)
        }
    }

    /// Whether two paths sit on the same disk (the same volume), so a move is a rename and not a copy.
    pub fn same_disk(a: &Path, b: &Path) -> bool {
        matches!((volume_of(a), volume_of(b)), (Some(x), Some(y)) if x == y)
    }

    /// Space this person may still use on the disk holding `dir`.
    pub fn free_bytes(dir: &Path) -> Option<u64> {
        let w = wide(dir);
        let mut avail: u64 = 0;
        // SAFETY: a NUL-terminated path and one out value; the totals are not asked for.
        let ok = unsafe { GetDiskFreeSpaceExW(w.as_ptr(), &mut avail, std::ptr::null_mut(), std::ptr::null_mut()) };
        (ok != 0).then_some(avail)
    }
}

#[cfg(target_os = "windows")]
pub use sys::*;

#[cfg(test)]
mod tests {
    use super::*;

    fn v4_table(rows: &[(u16, u32)]) -> Vec<u8> {
        let mut b = (rows.len() as u32).to_ne_bytes().to_vec();
        for &(port, pid) in rows {
            let port_field = u16::to_be(port) as u32;
            for v in [2u32 /* LISTEN */, 0x0100007f, port_field, 0, 0, pid] {
                b.extend_from_slice(&v.to_ne_bytes());
            }
        }
        b
    }

    #[test]
    fn finds_the_program_listening_on_a_port() {
        let t = v4_table(&[(5173, 400), (41730, 512), (4533, 600)]);
        assert_eq!(listeners_v4(&t, 41730), vec![512]);
        assert_eq!(listeners_v4(&t, 9999), Vec::<i32>::new());
    }

    #[test]
    fn a_short_or_empty_table_reads_as_nobody() {
        assert!(listeners_v4(&[], 41730).is_empty());
        let mut t = v4_table(&[(41730, 512)]);
        t.truncate(10);
        assert!(listeners_v4(&t, 41730).is_empty());
    }

    #[test]
    fn reads_the_ipv6_table_too() {
        let mut b = 1u32.to_ne_bytes().to_vec();
        b.extend_from_slice(&[0u8; 16]); // local address ::
        b.extend_from_slice(&0u32.to_ne_bytes()); // scope
        b.extend_from_slice(&(u16::to_be(4533) as u32).to_ne_bytes());
        b.extend_from_slice(&[0u8; 16]);
        b.extend_from_slice(&0u32.to_ne_bytes());
        b.extend_from_slice(&0u32.to_ne_bytes());
        b.extend_from_slice(&2u32.to_ne_bytes()); // LISTEN
        b.extend_from_slice(&777u32.to_ne_bytes());
        assert_eq!(listeners_v6(&b, 4533), vec![777]);
    }

    #[test]
    fn windows_and_finder_bookkeeping_is_not_music() {
        for n in [".DS_Store", "Thumbs.db", "thumbs.db", "desktop.ini", "Desktop.ini"] {
            assert!(system_file(std::ffi::OsStr::new(n)), "{n}");
        }
        assert!(!system_file(std::ffi::OsStr::new("cover.jpg")));
    }
}

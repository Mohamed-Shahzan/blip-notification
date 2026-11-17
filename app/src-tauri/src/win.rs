// Windows only: the front app, the app a session runs in, idle time and
// bringing an app forward. The counterpart of mac.rs (Windows Level 1, 14 Nov
// 2026). Plain Win32 calls from windows-sys; none asks for a permission.

use std::ptr::null_mut;

use windows_sys::Win32::Foundation::{
    CloseHandle, FILETIME, HANDLE, HWND, INVALID_HANDLE_VALUE, LPARAM,
};
use windows_sys::Win32::System::Diagnostics::ToolHelp::{
    CreateToolhelp32Snapshot, PROCESSENTRY32W, Process32FirstW, Process32NextW, TH32CS_SNAPPROCESS,
};
use windows_sys::Win32::System::SystemInformation::GetTickCount;
use windows_sys::Win32::System::Threading::{
    GetProcessTimes, OpenProcess, PROCESS_NAME_WIN32, PROCESS_QUERY_LIMITED_INFORMATION,
    QueryFullProcessImageNameW,
};
use windows_sys::Win32::UI::Input::KeyboardAndMouse::{GetLastInputInfo, LASTINPUTINFO};
use windows_sys::Win32::UI::WindowsAndMessaging::{
    EnumWindows, GW_OWNER, GWL_EXSTYLE, GetForegroundWindow, GetWindow, GetWindowLongW,
    GetWindowThreadProcessId, IsIconic, IsWindowVisible, SW_RESTORE, SetForegroundWindow,
    ShowWindow, WS_EX_APPWINDOW, WS_EX_TOOLWINDOW,
};

use crate::state::App;

// The Windows shell. A session never runs "in" File Explorer, so the walk up
// to the session's app stops here instead of opening an Explorer window.
const SHELL: &str = "explorer.exe";

// The front app's process id. None when no window is in front (for example
// while switching windows, or on the lock screen).
pub fn front_app() -> Option<i32> {
    let window = unsafe { GetForegroundWindow() };
    if window.is_null() {
        return None;
    }
    pid_of(window)
}

fn pid_of(window: HWND) -> Option<i32> {
    let mut pid = 0u32;
    unsafe { GetWindowThreadProcessId(window, &mut pid) };
    (pid != 0).then_some(pid as i32)
}

// Seconds since the last mouse or keyboard input in this user's session.
// None if Windows gave no answer.
pub fn idle_seconds() -> Option<f64> {
    let mut info = LASTINPUTINFO {
        cbSize: size_of::<LASTINPUTINFO>() as u32,
        dwTime: 0,
    };
    if unsafe { GetLastInputInfo(&mut info) } == 0 {
        return None;
    }
    Some(idle_between(unsafe { GetTickCount() }, info.dwTime))
}

// Both are milliseconds since the PC started, in 32 bits, so they roll over
// every 49.7 days; wrapping_sub keeps the difference right across it.
fn idle_between(now: u32, last_input: u32) -> f64 {
    now.wrapping_sub(last_input) as f64 / 1000.0
}

// The app with this process id, if it is a window app: one with a window on
// the taskbar (not a helper, a shell or a console program).
pub fn regular_app(pid: i32) -> Option<App> {
    app_window(pid as u32)?;
    let name = image_path(pid as u32)
        .map(|path| app_name(&path))
        .unwrap_or_default();
    Some(App { pid, name })
}

// The parent's process id, if the parent still runs, started before this
// process (Windows reuses ids, so an ended parent's id may now belong to
// another program) and is not the shell.
pub fn parent(pid: i32) -> Option<i32> {
    let (ppid, exe) = parent_entry(pid as u32)?;
    if exe.eq_ignore_ascii_case(SHELL) {
        return None;
    }
    let (child, parent) = (started(pid as u32)?, started(ppid)?);
    (parent <= child).then_some(ppid as i32)
}

// Brings the app with this process id to the front, restoring its window if
// minimised. False if it has no window or Windows said no. Windows allows it
// while Blip has just received the user's click.
pub fn bring_forward(pid: i32) -> bool {
    let Some(window) = app_window(pid as u32) else {
        return false;
    };
    unsafe {
        if IsIconic(window) != 0 {
            ShowWindow(window, SW_RESTORE);
        }
        SetForegroundWindow(window) != 0
    }
}

// The first window of this process that has a taskbar button.
fn app_window(pid: u32) -> Option<HWND> {
    struct Search {
        pid: u32,
        found: HWND,
    }
    unsafe extern "system" fn each(window: HWND, data: LPARAM) -> i32 {
        // Safety: data is the &mut Search below, alive for the whole EnumWindows call.
        let search = unsafe { &mut *(data as *mut Search) };
        if pid_of(window) == Some(search.pid as i32) && unsafe { has_taskbar_button(window) } {
            search.found = window;
            return 0; // found: stop
        }
        1
    }
    let mut search = Search {
        pid,
        found: null_mut(),
    };
    unsafe { EnumWindows(Some(each), &mut search as *mut Search as LPARAM) };
    (!search.found.is_null()).then_some(search.found)
}

unsafe fn has_taskbar_button(window: HWND) -> bool {
    let visible = unsafe { IsWindowVisible(window) } != 0;
    let owned = !unsafe { GetWindow(window, GW_OWNER) }.is_null();
    let style = unsafe { GetWindowLongW(window, GWL_EXSTYLE) } as u32;
    on_taskbar(visible, owned, style)
}

// Microsoft's taskbar rule ("Managing Taskbar Buttons"): a visible window
// gets a button if it is not owned, unless it is a tool window; an app window
// always gets one.
fn on_taskbar(visible: bool, owned: bool, style: u32) -> bool {
    visible && (style & WS_EX_APPWINDOW != 0 || (!owned && style & WS_EX_TOOLWINDOW == 0))
}

// The parent's id and the parent's file name, from one snapshot of all processes.
fn parent_entry(pid: u32) -> Option<(u32, String)> {
    let all = processes()?;
    let ppid = all.iter().find(|p| p.id == pid)?.parent;
    if ppid == 0 {
        return None;
    }
    let exe = all.iter().find(|p| p.id == ppid)?.exe.clone();
    Some((ppid, exe))
}

// The session's Claude process, from the hook script's own process id. The
// script runs in Git Bash, which cannot see a Windows parent (it reports 1),
// so the script sends its own id and Blip walks up past Git Bash (sh.exe,
// bash.exe) to the program that started it: claude.exe. Called before Blip
// answers the hook, while the script and its parents are sure to be running.
pub fn session_process(hook: u32) -> Option<u32> {
    first_outside_git_bash(&processes()?, hook)
}

// Git Bash's own programs between a hook script and Claude.
const GIT_BASH: [&str; 2] = ["sh.exe", "bash.exe"];

fn first_outside_git_bash(all: &[Proc], start: u32) -> Option<u32> {
    let mut id = start;
    // A few steps are enough (the script, then two bash.exe); the limit only
    // guards against a loop of ids.
    for _ in 0..8 {
        let process = all.iter().find(|p| p.id == id)?;
        if !GIT_BASH.iter().any(|g| process.exe.eq_ignore_ascii_case(g)) {
            return (id != start).then_some(id);
        }
        id = process.parent;
    }
    None
}

// One running process: its id, its parent's id and its program file name.
struct Proc {
    id: u32,
    parent: u32,
    exe: String,
}

// Every running process, from one snapshot. None if Windows gave none.
fn processes() -> Option<Vec<Proc>> {
    let snapshot = unsafe { CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0) };
    if snapshot == INVALID_HANDLE_VALUE {
        return None;
    }
    let mut entry = PROCESSENTRY32W {
        dwSize: size_of::<PROCESSENTRY32W>() as u32,
        ..Default::default()
    };
    let mut all = Vec::new();
    let mut more = unsafe { Process32FirstW(snapshot, &mut entry) } != 0;
    while more {
        all.push(Proc {
            id: entry.th32ProcessID,
            parent: entry.th32ParentProcessID,
            exe: wide_to_string(&entry.szExeFile),
        });
        more = unsafe { Process32NextW(snapshot, &mut entry) } != 0;
    }
    unsafe { CloseHandle(snapshot) };
    (!all.is_empty()).then_some(all)
}

// An open process, closed again when dropped. None if Windows refused
// (a process of another user or of the system).
struct Process(HANDLE);

impl Process {
    fn open(pid: u32) -> Option<Self> {
        let handle = unsafe { OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid) };
        (!handle.is_null()).then_some(Self(handle))
    }
}

impl Drop for Process {
    fn drop(&mut self) {
        unsafe { CloseHandle(self.0) };
    }
}

// When the process started, in Windows' 100 ns units.
fn started(pid: u32) -> Option<u64> {
    let process = Process::open(pid)?;
    let zero = FILETIME {
        dwLowDateTime: 0,
        dwHighDateTime: 0,
    };
    let (mut created, mut exited, mut kernel, mut user) = (zero, zero, zero, zero);
    let ok =
        unsafe { GetProcessTimes(process.0, &mut created, &mut exited, &mut kernel, &mut user) };
    (ok != 0).then_some((created.dwHighDateTime as u64) << 32 | created.dwLowDateTime as u64)
}

fn image_path(pid: u32) -> Option<String> {
    let process = Process::open(pid)?;
    let mut buffer = [0u16; 1024];
    let mut size = buffer.len() as u32;
    let ok = unsafe {
        QueryFullProcessImageNameW(
            process.0,
            PROCESS_NAME_WIN32,
            buffer.as_mut_ptr(),
            &mut size,
        )
    };
    (ok != 0).then(|| String::from_utf16_lossy(&buffer[..size as usize]))
}

// The program's file name without folder or ".exe": "Antigravity IDE".
fn app_name(path: &str) -> String {
    let file = path.rsplit(['\\', '/']).next().unwrap_or(path);
    let stem = file
        .len()
        .checked_sub(4)
        .filter(|&cut| file.is_char_boundary(cut) && file[cut..].eq_ignore_ascii_case(".exe"));
    stem.map_or(file, |cut| &file[..cut]).to_string()
}

fn wide_to_string(wide: &[u16]) -> String {
    let end = wide.iter().position(|&c| c == 0).unwrap_or(wide.len());
    String::from_utf16_lossy(&wide[..end])
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn idle_time_survives_the_tick_count_rolling_over() {
        assert_eq!(idle_between(10_000, 4_000), 6.0);
        // Last input 1 s before the 49.7-day rollover, now 2 s after it.
        assert_eq!(idle_between(2_000, u32::MAX - 999), 3.0);
        assert_eq!(idle_between(5, 5), 0.0);
    }

    #[test]
    fn follows_the_taskbar_rule() {
        assert!(on_taskbar(true, false, 0));
        assert!(!on_taskbar(false, false, 0), "hidden");
        assert!(!on_taskbar(true, true, 0), "owned, like a dialog");
        assert!(!on_taskbar(true, false, WS_EX_TOOLWINDOW), "tool window");
        assert!(
            on_taskbar(true, true, WS_EX_APPWINDOW),
            "app window, even when owned"
        );
        assert!(
            !on_taskbar(false, true, WS_EX_APPWINDOW),
            "hidden app window"
        );
    }

    #[test]
    fn names_the_app_after_its_program_file() {
        let ide = r"C:\Users\someone\AppData\Local\Programs\Antigravity IDE\Antigravity IDE.exe";
        assert_eq!(app_name(ide), "Antigravity IDE");
        assert_eq!(
            app_name(r"C:\Program Files\WindowsApps\Claude\app\Claude.EXE"),
            "Claude"
        );
        assert_eq!(app_name("C:/tools/notes"), "notes");
        assert_eq!(app_name("é.exe"), "é");
        assert_eq!(app_name("x"), "x");
    }

    #[test]
    fn reads_wide_strings_up_to_the_end_mark() {
        let mut wide = [0u16; 8];
        for (i, c) in "a.exe".encode_utf16().enumerate() {
            wide[i] = c;
        }
        assert_eq!(wide_to_string(&wide), "a.exe");
    }

    fn proc(id: u32, parent: u32, exe: &str) -> Proc {
        Proc {
            id,
            parent,
            exe: exe.to_string(),
        }
    }

    #[test]
    fn walks_from_the_hook_script_past_git_bash_to_claude() {
        // As seen on this PC (14 Nov): sh.exe, bash.exe, bash.exe, claude.exe.
        let all = [
            proc(41772, 64300, "sh.exe"),
            proc(64300, 60056, "bash.exe"),
            proc(60056, 49072, "Bash.EXE"),
            proc(49072, 41500, "claude.exe"),
            proc(41500, 48964, "Antigravity IDE.exe"),
        ];
        assert_eq!(first_outside_git_bash(&all, 41772), Some(49072));
    }

    #[test]
    fn gives_nothing_for_an_unknown_or_ended_script() {
        let all = [
            proc(10, 11, "sh.exe"),
            proc(20, 21, "claude.exe"),
            proc(30, 30, "bash.exe"),
        ];
        assert_eq!(first_outside_git_bash(&all, 99), None, "not running");
        assert_eq!(first_outside_git_bash(&all, 10), None, "parent gone");
        assert_eq!(first_outside_git_bash(&all, 20), None, "not a hook script");
        assert_eq!(first_outside_git_bash(&all, 30), None, "a loop of ids");
    }

    // On this PC, live: the readings answer, and the walk up from this test
    // reaches its parent (cargo), which started before it. Depends on the
    // desktop and on who started the tests (code review 15 Nov), so it only
    // runs on request: cargo test -- --ignored
    #[test]
    #[ignore = "reads the live PC; run with --ignored"]
    fn reads_this_pc() {
        assert!(idle_seconds().is_some());
        let me = std::process::id() as i32;
        let up = parent(me).expect("cargo starts the tests, and it is older");
        assert_ne!(up, me);
        assert!(regular_app(me).is_none(), "a test has no taskbar window");
    }
}
